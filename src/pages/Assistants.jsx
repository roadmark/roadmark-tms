import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';
import { Chip, DeptChip, Empty, ErrorNote } from '../components/ui';
import { DEPARTMENTS, DEPT_COLORS } from '../data/permissions';
import { ago, title } from '../lib/format';

/* The four assistants and exactly what they do, step by step.
   Telegram wiring goes live at the end of the build (Phase 13);
   until then this page documents every action and previews the live feed. */
const BOTS = [
  {
    icon: '📄', name: 'BOL bot', depts: ['dispatch'],
    tagline: 'Driver sends the Bill of Lading in the truck group — dispatch approves, the broker chain gets the loaded notice.',
    actions: [
      'Driver posts BOL photo/PDF in the Telegram group titled with the truck number.',
      'Bot reads it with AI: freight, weight, special instructions, temperature, delivery address, appointment date/time — and cross-checks against the rate confirmation, flagging mismatches.',
      'Bot posts the summary in the group and tags the load\'s dispatcher with Yes / No buttons. Only the dispatcher\'s (or dispatch manager\'s) press counts.',
      'On YES: sends the dispatcher\'s "we are loaded" template + the BOL as a reply-all into the broker email chain, attaches the BOL to the load, updates confirmed fields.',
      'On NO: nothing is sent; dispatcher handles manually. Every decision is logged here.',
    ],
  },
  {
    icon: '🛰️', name: 'Tracking assistant', depts: ['dispatch', 'tracking'],
    tagline: 'After pickup, broker and their tracking department get a location update every 60 minutes — in their own email thread.',
    actions: [
      'Activates when a load turns in_progress and has a linked broker email thread.',
      'Every 60 min (per-load configurable): pulls the truck\'s latest ELD position, computes ETA to the next stop.',
      'Sends the update as reply-all in the existing conversation — broker + their tracking dept, same thread.',
      'Stops automatically on delivery; optional overnight quiet hours; if the ELD is silent >90 min it alerts dispatch instead of emailing stale data.',
      'Each sent update is also recorded as a check call on the load.',
    ],
  },
  {
    icon: '⏰', name: 'Reminder bot', depts: ['dispatch', 'safety', 'maintenance'],
    tagline: 'Tags the right people before things are late: appointments, expiring documents, PM service.',
    actions: [
      'Appointment reminders 2 h before pickup/delivery — tags driver + dispatcher in the truck group.',
      'Compliance expiries (Medical card, MVR, registration, 2290…) — tags the driver and the safety department; the action shows in Safety here in the TMS.',
      'PM service due by odometer — tags maintenance.',
      'Anyone can add manual reminders from the app or with /remind in the group.',
    ],
  },
  {
    icon: '🛞', name: 'DOT compliance bot (PTI)', depts: ['safety', 'maintenance'],
    tagline: 'Screens the driver\'s pre-trip inspection photos for visible DOT problems before a DOT officer finds them.',
    actions: [
      'Driver posts PTI walk-around photos in the truck group.',
      'AI screens for visible issues: bald/flat tires, broken lights and lenses, windshield cracks in the wiper sweep, leaks, air lines, mudflaps, body damage, missing placards.',
      'Clean: "PTI received — no visible issues" and the inspection is logged to the truck\'s history.',
      'Flagged: tags driver, dispatcher, maintenance, safety and their team leaders with the findings + photos; creates a maintenance flag and a safety review entry here.',
      'It is a screening aid, not an inspection — wording always says "possible / appears" and a human confirms.',
    ],
  },
  {
    icon: '🚨', name: 'Safety bot (accidents)', depts: ['safety', 'dispatch', 'maintenance', 'fleet', 'tracking'],
    tagline: 'Any accident message from a driver triggers an instant all-department alert.',
    actions: [
      'Screens every group message: instant keyword layer (crash, accident, hit, rollover…) + AI layer for phrasing like "guy slammed brakes and I clipped him" — any language.',
      'On trigger: immediately tags dispatcher, safety, maintenance, fleet, tracking (+ the after-hours on-call group at night) and all their team leaders.',
      'Creates an incident record with the driver\'s exact words, truck, load, and last ELD position attached.',
      'Red-banner alert in the TMS; escalates by email/SMS if nobody acknowledges within 10 minutes.',
      'Deliberately biased toward false alarms — dismissing one costs a tap; missing a real one is not an option.',
    ],
  },
];

export default function Assistants() {
  const { companyId } = useAuth();
  const [dept, setDept] = useState('');

  const feed = useQuery({
    queryKey: ['activity-page', companyId, dept],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('v_department_activity').select('*')
        .eq('company_id', companyId)
        .order('happened_at', { ascending: false }).limit(60);
      if (dept) q = q.eq('department', dept);
      const { data, error } = await q;
      if (error) throw error;
      if (dept) return data.map((r) => ({ ...r, departments: [r.department] }));
      const seen = new Map();
      for (const r of data) {
        const k = r.source + r.source_id;
        if (!seen.has(k)) seen.set(k, { ...r, departments: [r.department] });
        else seen.get(k).departments.push(r.department);
      }
      return [...seen.values()];
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>Assistants</h2>
        <div className="spacer" />
        <span className="chip yellow">Telegram bots go live in Phase 13 — playbooks below are final</span>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        {BOTS.map((b) => (
          <div className="card card-pad" key={b.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 22 }}>{b.icon}</span>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16 }}>{b.name}</h3>
              <div className="spacer" style={{ flex: 1 }} />
              {b.depts.map((dp) => <span key={dp} className="dept-dot" title={dp}
                style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: DEPT_COLORS[dp] }} />)}
            </div>
            <p className="muted" style={{ margin: '4px 0 10px' }}>{b.tagline}</p>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {b.actions.map((a, i) => <li key={i} className="small">{a}</li>)}
            </ol>
          </div>
        ))}
      </div>

      <div className="card card-pad">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 16 }}>Assistant activity feed</h2>
        </div>
        <div className="filter-row">
          <span className={`chip gray ${dept === '' ? 'on' : ''}`} onClick={() => setDept('')}>All departments</span>
          {DEPARTMENTS.map((dp) => (
            <span key={dp} className={`chip gray dept-chip ${dept === dp ? 'on' : ''}`}
              style={{ borderLeftColor: DEPT_COLORS[dp] }}
              onClick={() => setDept(dp)}>{title(dp)}</span>
          ))}
        </div>
        <ErrorNote error={feed.error} />
        {feed.data?.length === 0 && (
          <Empty head="No activity for this filter"
            sub="Every bot action lands here and in the involved department's module." />
        )}
        {(feed.data || []).map((r) => (
          <div className="feed-item" key={r.source + r.source_id + (r.departments?.[0] || '')}>
            <div className="feed-rail" style={{ background: DEPT_COLORS[r.departments?.[0]] || 'var(--accent)' }} />
            <div style={{ flex: 1 }}>
              <div className="feed-title">{r.title}</div>
              <div className="feed-meta">{title(r.source)} · {title(r.kind)} · {ago(r.happened_at)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {(r.departments || []).map((dp) => <DeptChip key={dp} dept={dp} />)}
              <Chip value={r.status} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
