import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FullPageError } from "@/components/common/full-page-error";
import { ROUTES } from "@/routes/paths";
import { usePageTitle } from "@/hooks/use-page-title";

export default function UnauthorizedPage() {
  usePageTitle("Not authorised");
  return (
    <FullPageError
      logoHref={ROUTES.home}
      title="You don't have access"
      message="Your account can't open this page. Ask your administrator if you think it should."
      action={
        <Button asChild className="h-12 px-8 text-base font-semibold">
          <Link to={ROUTES.home}>Back to home</Link>
        </Button>
      }
    />
  );
}
