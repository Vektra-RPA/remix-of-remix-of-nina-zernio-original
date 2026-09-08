import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { broadcastsApi, type BroadcastCampaign } from '@/services/broadcasts';

/** Campanhas com atualização ao vivo — o motor roda no servidor. */
export function useBroadcasts() {
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setCampaigns(await broadcastsApi.listCampaigns());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as campanhas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const channel = supabase
      .channel('broadcast-campaigns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_campaigns' }, () => reload())
      .subscribe();
    const timer = window.setInterval(reload, 15_000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(timer);
    };
  }, [reload]);

  return { campaigns, loading, error, reload };
}
