import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  UnderlineIcon,
  List,
  ListOrdered,
  Heading2,
  Link as LinkIcon,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isSafeHref } from "@/lib/html-sanitize";
import { Button } from "@/components/ui/button";
import { LinkDialog } from "@/components/common/link-dialog";

/** Handed to `toolbarExtra` so a caller can put text into the document. */
export type RichTextEditorApi = {
  /** Inserts plain text at the cursor and returns focus to the document. */
  insertText: (text: string) => void;
};

interface RichTextEditorProps {
  content: JSONContent | null;
  onChange: (json: JSONContent, text: string) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  /** Accessible name for the editing area (WCAG 4.1.2), e.g. "Judgment text". Use `ariaLabelledBy` instead when a visible label exists. */
  ariaLabel?: string;
  /** Id of a visible label element naming the editing area. */
  ariaLabelledBy?: string;
  /**
   * Extra toolbar control, rendered after Link and only while editable.
   * A render prop rather than a node because the control needs to write
   * into the document, and the editor instance is deliberately private —
   * the component is lazy-loaded, so a ref would have to cross a Suspense
   * boundary. Keeps domain features (Quick Codes) out of this generic
   * editor.
   */
  toolbarExtra?: (api: RichTextEditorApi) => ReactNode;
}

/**
 * Shared Tiptap-based editor for `content` (jsonb) / `content_text`
 * (plain text, used for search indexing) column pairs — Judgments today,
 * reusable for Bench Notes. Deliberately a plain paragraphs/lists/
 * headings/bold/italic/underline/link toolbar, not a full document
 * editor — this is the simplest safe editor consistent with the
 * existing `content_text` schema, not an invented rich-content model.
 *
 * Accessibility: the ProseMirror surface is a named multiline textbox,
 * the toolbar is a `role="toolbar"` with arrow-key movement between its
 * buttons, and link insertion goes through an accessible dialog rather
 * than `window.prompt`.
 */
export function RichTextEditor({
  content,
  onChange,
  editable = true,
  placeholder = "Start writing…",
  className,
  ariaLabel,
  ariaLabelledBy,
  toolbarExtra,
}: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitial, setLinkInitial] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        isAllowedUri: (url) => isSafeHref(url ?? ""),
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: content ?? "",
    editable,
    onUpdate: ({ editor: e }) => {
      onChange(e.getJSON(), e.getText());
    },
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
        class: cn("richtext-content focus:outline-none min-h-[200px] px-3 py-2"),
      },
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  // WAI-ARIA toolbar pattern: Left/Right (and Home/End) move between the
  // buttons so the toolbar is one Tab stop rather than seven.
  const handleToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
    else next = (current - 1 + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const openLinkDialog = () => {
    const existing = editor.getAttributes("link").href;
    setLinkInitial(typeof existing === "string" ? existing : "");
    setLinkOpen(true);
  };

  return (
    <div
      className={cn(
        // Read-only text sits unframed on its card in a reading column; the
        // editor keeps its frame and full width.
        editable
          ? "rounded-md border border-input bg-surface-2/60 transition-shadow focus-within:ring-1 focus-within:ring-ring hc:bg-transparent"
          : "max-w-measure",
        className,
      )}
    >
      {editable && (
        <div
          role="toolbar"
          aria-label="Text formatting"
          aria-orientation="horizontal"
          className="flex flex-wrap items-center gap-1 border-b border-input p-1"
          onKeyDown={handleToolbarKeyDown}
        >
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            label="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            label="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            label="Underline"
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            label="Heading"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            label="Bulleted list"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            label="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("link")}
            onClick={openLinkDialog}
            label={editor.isActive("link") ? "Edit link" : "Insert link"}
            hasPopup="dialog"
          >
            <LinkIcon className="h-4 w-4" />
          </ToolbarButton>
          {toolbarExtra?.({
            insertText: (text) => editor.chain().focus().insertContent(text).run(),
          })}
        </div>
      )}
      <EditorContent editor={editor} />
      {editable && (
        <LinkDialog
          open={linkOpen}
          onOpenChange={(open) => {
            setLinkOpen(open);
            if (!open) editor.commands.focus();
          }}
          initialHref={linkInitial}
          onSubmit={(href) => {
            // LinkDialog already validated; re-checking keeps the guard
            // next to the command that writes the href into the document.
            if (!isSafeHref(href)) return;
            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }}
          onRemove={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  hasPopup,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hasPopup?: "dialog";
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="h-7 w-7"
      onClick={onClick}
      aria-label={label}
      aria-pressed={hasPopup ? undefined : active}
      aria-haspopup={hasPopup}
    >
      {children}
    </Button>
  );
}
