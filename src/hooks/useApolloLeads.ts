import { useCallback, useEffect, useState } from 'react';
import { apolloLeadsApi, type ApolloLead, type ApolloRun, type ApolloSettings } from '@/services/apolloLeads';

export function useApolloLeads() {
  const [leads, setLeads] = useState<ApolloLead[]>([]);
  const [runs, setRuns] = useState<ApolloRun[]>([]);
  const [settings, setSettings] = useState<ApolloSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [leadsData, runsData, settingsData] = await Promise.all([
        apolloLeadsApi.listLeads(),
        apolloLeadsApi.listRuns(),
        apolloLeadsApi.getSettings(),
      ]);
      setLeads(leadsData);
      setRuns(runsData);
      setSettings(settingsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { leads, runs, settings, loading, error, reload };
}
