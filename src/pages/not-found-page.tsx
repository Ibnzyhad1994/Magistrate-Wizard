import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FullPageError } from "@/components/common/full-page-error";
import { ROUTES } from "@/routes/paths";
import { usePageTitle } from "@/hooks/use-page-title";

export default function NotFoundPage() {
  usePageTitle("Page not found");
  return (
    <FullPageError
      logoHref={ROUTES.home}
      title="Lost your way?"
      message="That page doesn't exist or has moved. Try the home page."
      action={
        <Button asChild className="h-12 px-8 text-base font-semibold">
          <Link to={ROUTES.home}>Back to home</Link>
        </Button>
      }
    />
  );
}
