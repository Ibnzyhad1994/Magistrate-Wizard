import { SharingPanel } from "@/components/sharing/sharing-panel";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";

interface SharingSectionProps {
  matterId: string;
  frozen?: boolean;
}

export function SharingSection({ matterId, frozen = false }: SharingSectionProps) {
  const { data: access } = useDocketMatterAccess(matterId);
  const canManage = (access?.canManage ?? false) && !frozen;
  return <SharingPanel itemType="docket_matter" itemId={matterId} canManage={canManage} />;
}
