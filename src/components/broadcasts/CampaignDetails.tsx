import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { broadcastsApi, type BroadcastCampaign, type BroadcastRecipient } from '@/services/broadcasts';

const STATUS_LABEL: Record<BroadcastRecipient['status'], string> = {
  pending: 'Na fila',
  sent: 'Enviada',
  failed: 'Falhou',
};

interface Props {
  campaign: BroadcastCampaign | null;
  onClose: () => void;
}

const CampaignDetails: React.FC<Props> = ({ campaign, onClose }) => {
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setLoading(true);
    broadcastsApi.listRecipients(campaign.id)
      .then(setRecipients)
      .finally(() => setLoading(false));
  }, [campaign]);

  return (
    <Dialog open={!!campaign} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign?.name}</DialogTitle>
          <DialogDescription>
            Template {campaign?.template_name} · {campaign?.sent_count ?? 0} enviadas · {campaign?.failed_count ?? 0} falhas
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto space-y-1">
          {loading && <span className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</span>}
          {!loading && recipients.map((recipient) => (
            <div key={recipient.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-2">
              <div className="min-w-0">
                <p className="text-sm truncate">{recipient.contact_name || recipient.phone_number}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {recipient.phone_number}{recipient.error_message ? ` · ${recipient.error_message}` : ''}
                </p>
              </div>
              <Badge variant={recipient.status === 'failed' ? 'destructive' : 'secondary'}>
                {STATUS_LABEL[recipient.status]}
              </Badge>
            </div>
          ))}
          {!loading && recipients.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum destinatário nesta campanha.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignDetails;
