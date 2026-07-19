// Mirrors the CHECK constraints in supabase/migrations — keep in sync.
export const LOAD_STATUSES = ['scheduled','in_progress','delivered','cancelled','tonu','invoiced','payment_pending','completed'];
export const DRIVER_STATUSES = ['active','at_leave','applicant','ex_applicant','approved','ready','rejected','terminated'];
export const DRIVER_TYPES = ['company','owner','rent','lease_to_buy','contractor'];
export const UNIT_STATUSES = ['active','pending','unusable','ready','recovery','shop','not_used','crash','for_shop','for_check','rented','terminated'];
export const OWNERSHIP = ['company','owner','rent','lease_to_buy'];
export const TRUCK_TYPES = ['semi_truck','box_truck'];
export const TRAILER_TYPES = ['dry_van','reefer','flatbed','box','power_only','other'];
export const PAY_TYPES = ['percentage','per_total_mile','per_loaded_mile','flat'];
export const MAINT_STATUSES = ['in_progress','to_be_paid','check','on_hold','paid','rejected'];
export const DEDUCTION_CATEGORIES = ['maintenance','efs','fuel','toll','drug_test','late_fee','missed_appointment','registration','advance','escrow','damage','citation','other'];

export const STATUS_CHIP = {
  scheduled: 'blue', in_progress: 'yellow', delivered: 'green', invoiced: 'purple',
  payment_pending: 'orange', completed: 'green', cancelled: 'gray', tonu: 'red',
  active: 'green', ready: 'blue', at_leave: 'yellow', terminated: 'gray',
  applicant: 'cyan', approved: 'blue', shop: 'orange', for_shop: 'orange',
  for_check: 'yellow', crash: 'red', recovery: 'purple', not_used: 'gray',
  pending: 'yellow', unusable: 'red', rented: 'cyan', rejected: 'red', ex_applicant: 'gray',
  open: 'yellow', closed: 'green', paid: 'green', in_progress_m: 'yellow',
  sent: 'green', flagged: 'red', pass: 'green', awaiting_approval: 'yellow',
};
