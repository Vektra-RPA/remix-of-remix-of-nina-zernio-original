import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import type { PilotOutsideContact } from '../services/pilot';
import {
  BUCKET_LABEL,
  SITUACAO_LABEL,
  SITUACAO_ORDER,
  TOUCH_DAY,
  bucketOf,
  fmtDay,
  type LeadView,
} from '../domain/campaign-dashboard';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import './DashboardCampaign.css';

// Lista aberta ao clicar num número (Dashboard e Piloto): quem está por trás dele
// e em que situação cada um está. Contatos fora do lote (testes internos) vêm
// numa seção separada, porque não entram nos indicadores.
export interface LeadDrill {
  title: string;
  description: string;
  ids: string[];
  outside?: PilotOutsideContact[];
}

interface LeadListSheetProps {
  drill: LeadDrill | null;
  viewOf: Map<string, LeadView>;
  conversationOf: Record<string, string>;
  onClose: () => void;
}

const ConversationLink: React.FC<{ id?: string }> = ({ id }) =>
  id ? (
    <Link to={`/chat?conversation=${id}`} className="dash-link">
      Abrir conversa <ChevronRight aria-hidden="true" />
    </Link>
  ) : null;

export const LeadListSheet: React.FC<LeadListSheetProps> = ({ drill, viewOf, conversationOf, onClose }) => {
  const views = (drill?.ids ?? []).map((id) => viewOf.get(id)).filter((v): v is LeadView => Boolean(v));
  const outside = drill?.outside ?? [];
  const summary = SITUACAO_ORDER
    .map((s) => ({ s, n: views.filter((v) => v.situacao === s).length }))
    .filter((x) => x.n > 0);

  return (
    <Sheet open={drill !== null} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent side="right" className="dash-sheet">
        <SheetHeader>
          <SheetTitle>{drill?.title} · {views.length}{outside.length > 0 ? ` (+${outside.length} fora dos números)` : ''}</SheetTitle>
          <SheetDescription>{drill?.description}</SheetDescription>
        </SheetHeader>

        {summary.length > 1 && (
          <ul className="dash-sheet__summary" aria-label="Resumo por situação">
            {summary.map(({ s, n }) => (
              <li key={s}>
                <span className={`dash-swatch dash-sit--${s}`} aria-hidden="true" />
                {SITUACAO_LABEL[s]} <strong>{n}</strong>
              </li>
            ))}
          </ul>
        )}

        {views.length === 0 && outside.length === 0 ? (
          <p className="dash-muted dash-sheet__empty">Nenhum lead aqui.</p>
        ) : (
          <ul className="dash-sheet__list">
            {views.map((v) => (
              <li key={v.row.contactId} className="dash-lead">
                <div className="dash-lead__top">
                  <div>
                    <strong>{v.row.nome}</strong>
                    <span>{[v.row.empresa, v.row.cargo].filter((x) => x && x !== '—').join(' · ') || '—'}</span>
                  </div>
                  {v.row.persona !== '—' && <span className="dash-chip">{v.row.persona}</span>}
                </div>
                <p className="dash-lead__status">
                  <span className={`dash-swatch dash-sit--${v.situacao}`} aria-hidden="true" />
                  <span><strong className="dash-inline">{SITUACAO_LABEL[v.situacao]}</strong> · {v.detalhe}</span>
                </p>
                <div className="dash-touches" aria-label="Toques da cadência">
                  {v.row.touches.map((t) => {
                    const bucket = bucketOf(t);
                    return (
                      <span
                        key={t.step}
                        className={`dash-touch dash-b--${bucket}`}
                        title={[`${TOUCH_DAY[t.step] ?? t.step} · ${t.canal}: ${BUCKET_LABEL[bucket].toLowerCase()}`, t.at ? fmtDay(t.at) : null, t.detail].filter(Boolean).join(' — ')}
                      >
                        {TOUCH_DAY[t.step] ?? t.step}
                      </span>
                    );
                  })}
                </div>
                <ConversationLink id={conversationOf[v.row.contactId]} />
              </li>
            ))}
          </ul>
        )}

        {outside.length > 0 && (
          <>
            <p className="dash-sheet__section">Fora dos números (não contam nos indicadores)</p>
            <ul className="dash-sheet__list dash-sheet__list--tight">
              {outside.map((c) => (
                <li key={c.contactId} className="dash-lead dash-lead--muted">
                  <strong>{c.nome}</strong>
                  <p className="dash-lead__status">{c.detalhe}</p>
                  <ConversationLink id={conversationOf[c.contactId]} />
                </li>
              ))}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
