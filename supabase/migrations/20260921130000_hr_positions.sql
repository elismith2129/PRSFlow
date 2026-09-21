-- POSITIONS (Eli, 2026-09-21): "billing coordinator is not supervisory. but i
-- think we should be able to set things like that in the app… needs to be
-- idiot proof. we do these so rarely it's hard to build the muscle."
--
-- One row per job title. The hiring case picks a position instead of a
-- free-typed title, so the checklist KNOWS: a supervisory position adds the
-- 2-hour harassment course and the ADP Manager flag; a non-supervisory one
-- doesn't. The offer letter reads vacation days and usual hours from here.
-- The job description text lives here too — the seed for the JD the case
-- sends (part 2). Edited on the Positions page (Admin group).
--
-- Seeded from the real documents Eli sent: Fernando's, Sam's and Lori Beth's
-- letters (vacation: managers 6 days / 48h, assistant managers and the
-- billing coordinator 5 days / 40h, front-loaded Jan 1) and the Assistant
-- Studio Manager + Billing & Accounting Coordinator job descriptions. The
-- Studio Manager JD is a DRAFT — none exists on paper — written from the
-- Asst. Manager JD plus PRG-P01's manager duties; edit it on the page.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code ships.

create table if not exists hr_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  is_supervisory boolean not null default false,
  vacation_days numeric(4,1) not null default 0,
  default_hours_week int,
  reports_to text,
  -- which PRSFlo role a person in this position gets (user_profiles.role)
  prsflo_role text check (prsflo_role is null or prsflo_role in ('owner','manager','billing','asst_manager','tech','runner')),
  jd_body text,
  jd_is_draft boolean not null default false,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_hr_positions_touch on hr_positions;
create trigger trg_hr_positions_touch before update on hr_positions
  for each row execute function touch_hr_updated_at();

grant select, insert, update, delete on hr_positions to authenticated;
alter table hr_positions enable row level security;

-- Titles are not secret (they're on the rail and the roster); editing is
-- owner + manager, like the rest of the HR layer.
drop policy if exists hr_positions_sel on hr_positions;
create policy hr_positions_sel on hr_positions
  for select to authenticated using (true);
drop policy if exists hr_positions_write on hr_positions;
create policy hr_positions_write on hr_positions
  for all to authenticated
  using (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));

alter table hr_positions replica identity full;
do $$
begin
  alter publication supabase_realtime add table hr_positions;
exception when duplicate_object then null;
end $$;

-- What position someone holds today. Free text on purpose (a title can be
-- renamed on the Positions page without cascading); the case sets it on the
-- effective date via the "role changed in PRSFlo" step.
alter table public.user_profiles add column if not exists position_title text;

-- The case remembers which position it's for, and where the person came from
-- (so a promotion knows whether they ALREADY supervised).
alter table public.hr_cases add column if not exists position_id uuid references hr_positions(id) on delete set null;
alter table public.hr_cases add column if not exists from_position_title text;
alter table public.hr_cases add column if not exists was_supervisory boolean;

-- ── seed ──────────────────────────────────────────────────────────────────

insert into hr_positions (title, is_supervisory, vacation_days, default_hours_week, reports_to, prsflo_role, sort_order, jd_is_draft, jd_body)
values
('Studio Manager', true, 6, 40, 'General Manager', 'manager', 10, true,
$JD$Position Title: Studio Manager
Reports to: General Manager

Position Overview
The Studio Manager runs the day-to-day operation of a high-volume recording facility across Paramount Recording Group's studios. The role owns bookings and client relationships at the operational level, directs the assistant managers, runners and contractors, and is the studio's first point of accountability for hospitality, readiness and the daily work orders. The Studio Manager also carries the studio's administrative and HR protocols (PRG-P01 through P04): daily timecards, punch corrections, onboarding and offboarding, and required training records.

Key Responsibilities

Bookings & Clients
• Own the calendar: confirm sessions, resolve conflicts, and keep every work order accurate from booking through billing hand-off.
• Field incoming inquiries and route pitches to the General Manager; keep leads moving in the CRM.
• Be the client's day-to-day contact for scheduling, session details and escalations.

Staff & Contractors
• Direct assistant managers and runners; set shift coverage and confirm daily staffing against the schedule.
• Schedule and brief engineers, assistants, maintenance and cleaners; make sure every contractor has instructions before they arrive.
• Bring notable staff, client or facility issues to the General Manager promptly.

Daily Administration (PRG-P01 to P04)
• Review timecards daily and clear exceptions in ADP; work the punch-correction queue; never edit a punch without the employee's written confirmation.
• Run onboarding and offboarding from the PRSFlo checklist: notices, I-9 deadlines, CalSavers, training records, day-one setup and close-out.
• Keep the training tracker current (harassment prevention, workplace violence) and run the quarterly audit.

Hospitality & Readiness
• Hold rooms and common areas to the hospitality standard; make sure amenities and protocols are followed on every shift.
• Anticipate session needs and clear small problems before they reach the client.

Required Skills & Qualifications
• Several years in studio operations, hospitality management or a comparable operational role, with direct supervision of staff.
• Calm, organized and decisive in a busy environment with frequent interruptions.
• Strong written and verbal communication; comfortable with Google Workspace, Slack, ADP and PRSFlo.

Working Conditions
• Extended periods at a computer; occasional light lifting; evening and weekend coverage as the schedule requires.
• Busy studio environment with shifting priorities and time-sensitive decisions.$JD$),

('Assistant Studio Manager', false, 5, 32, 'Studio Manager', 'asst_manager', 20, false,
$JD$Position Title: Assistant Studio Manager
Reports to: Studio Manager

Position Overview
The Assistant Studio Manager supports the Studio Manager in daily operational oversight of a high-volume recording facility. This role is primarily administrative, focusing on managing bookings, coordinating contractors, handling in-house hospitality, and flagging notable operational issues to the Studio Manager and General Manager. The position ensures smooth workflow, strong client service, and organized studio operations.

Key Responsibilities

Bookings & Client Support
• Manage and confirm session bookings under the direction of the Studio Manager.
• Handle client communication for scheduling, session details, and general inquiries.
• Provide professional, attentive service to clients and ensure clear handoffs to engineering staff.

Contractor Coordination
• Schedule and communicate with contractors (engineers, assistants, maintenance, cleaners, etc.) as directed by the Studio Manager.
• Ensure contractors have proper instructions.
• Report any issues or delays immediately to the Studio Manager and General Manager.

Hospitality & Studio Readiness
• Maintain studio presentation and ensure rooms and common areas meet hospitality standards.
• Oversee client amenities and ensure hospitality protocols are consistently followed by staff.
• Support session flow by anticipating needs and addressing minor issues promptly.

Administrative Support
• Assist with booking documentation, session notes, and operational logs.
• Maintain accurate internal communication across teams using Google Workspace, Slack, and other platforms.
• Bring any notable client, facility, or staff concerns to the immediate attention of the Studio Manager and General Manager.
• Support the Studio Manager with administrative tasks and special projects as needed.

Required Skills & Qualifications
• Experience in studio operations, hospitality, or administrative support.
• Strong written and verbal communication skills.
• Highly organized, detail-oriented, and comfortable managing multiple tasks.
• Proficiency with Google Workspace, Slack, and similar tools.
• Professional, calm, and solutions-oriented in a fast-paced environment.

Working Conditions
• Extended periods using office equipment and computers; occasional light lifting.
• Work performed in a busy studio environment with frequent interruptions.
• Must manage shifting priorities and maintain accuracy under time-sensitive conditions.$JD$),

('Billing & Accounting Coordinator', false, 5, 40, 'Studio Manager and Accounting Manager', 'billing', 30, false,
$JD$Position Title: Billing and Accounting Coordinator
Reports to: Studio Manager and Accounting Manager

Position Overview
The Billing and Accounting Coordinator will be responsible for managing accounts receivable and accounts payable functions while supporting the daily operations of the studio. This role requires close collaboration with the General Manager, Accounting Manager, and Studio Manager to ensure efficient financial processes and accurate record-keeping. The ideal candidate will be detail-oriented, organized, and able to handle multiple responsibilities in a fast-paced environment.

Key Responsibilities

Accounts Receivable (AR)
• Invoice Preparation: Prepare, issue, and send accurate invoices to clients in a timely manner.
• Payment Processing: Track and monitor invoice statuses, receive payments, and update client accounts.
• Account Reconciliation: Reconcile customer accounts, resolve discrepancies, and manage disputes efficiently.
• Customer Support: Address and resolve client billing inquiries professionally and promptly.
• Aging Reports: Collaborate with the General Manager to review overdue accounts and implement collection strategies.

Accounts Payable (AP)
• Vendor Invoice Processing: Review, process, and schedule vendor payments, ensuring timely and accurate handling of expenses.
• Expense Tracking: Maintain detailed records of all expenses and update the accounting system regularly.
• Account Reconciliation: Reconcile vendor accounts and address any discrepancies with vendors.
• Vendor Relationship Management: Maintain strong relationships with vendors and oversee account inquiries.
• Record Keeping: Organize and file all accounts payable documents, including invoices and payment confirmations.

Reception and Administrative Duties
• Call Management: Answer and transfer phone calls efficiently, maintaining a professional and courteous demeanor.
• Call Log and Client List Maintenance: Keep the call log updated and manage the master client list in collaboration with the Studio Manager.
• Work Order Creation: Create and process work orders as needed for studio sessions.

Billing Responsibilities
• Daily Invoicing: Finalize and send invoices for confirmed sessions in coordination with the General Manager. Handle COD client invoicing during business hours (Mon–Fri, 9 AM – 5 PM). Follow up on any outstanding balances for COD clients.
• Weekend Invoicing: Oversee billing for sessions scheduled over the weekend; the Studio Manager will initiate invoices, and the Billing Coordinator will finalize and send them on Mondays.
• Tenant Rent Payments: Manage monthly rent invoicing for long-term studio tenants, including sending invoices and collecting payments.

Vendor Invoice Management
• AP Email Monitoring: Regularly check the AP@ email inbox for vendor invoices and communications.
• Vendor Invoice Processing: Review all vendor invoices for accuracy, upload them to the accounting system (Ramp), and prepare for approval by the General Manager.
• File Management: Download, review, and file all accounts payable vendor invoices, including engineering, Waste Management, SIR, etc.

Required Skills and Qualifications
• Experience: Minimum of 2 years of experience in billing, accounts receivable, and accounts payable roles.
• Technical Skills: Proficiency in accounting software (e.g., QuickBooks, Ramp), Google Sheets, and Microsoft Excel.
• Attention to Detail: Strong analytical skills and high level of accuracy in handling financial data.
• Communication: Excellent written and verbal communication skills for client and vendor interactions.
• Time Management: Ability to manage multiple tasks and deadlines effectively.
• Team Collaboration: Strong interpersonal skills and ability to work collaboratively with the General Manager, Accounting Manager, and Studio Manager.$JD$),

('Runner', false, 0, null, 'Studio Manager', 'runner', 40, true,
$JD$Position Title: Runner
Reports to: Studio Manager

Position Overview
The Runner keeps the studio's sessions running: opening and closing rooms, hospitality and supply runs, the nightly mic inventory, the daily checklists and work-order paperwork in PRSFlo, and being the first set of hands for engineers and clients.

Key Responsibilities
• Open and close the studio per the checklist; keep rooms and common areas session-ready.
• Run client hospitality: food and supply runs, petty cash logged in PRSFlo.
• Complete the nightly mic inventory — eyes on every mic, every night.
• Keep the day's work orders current in the runner hub; submit at end of session.
• Flag facility, gear and client issues the moment they come up.

Required Skills & Qualifications
• Reliable, punctual, and comfortable working evenings and weekends.
• Valid driver's license and a clean driving record for runs.
• Calm and courteous with clients; follows instructions precisely.$JD$),

('Tech', false, 0, null, 'Studio Manager', 'tech', 50, true,
$JD$Position Title: Studio Technician
Reports to: Studio Manager

Position Overview
The Tech keeps the studios working: building maintenance, gear repair and QC, the mic inventory's condition checks, and the flag queue for facility and equipment issues across all four locations.

Key Responsibilities
• Work the tech flag queue: acknowledge, fix or route, record vendor and cost.
• Maintain and QC microphones, outboard and studio wiring; keep the inventory's condition notes current.
• Building maintenance and vendor coordination for repairs beyond in-house scope.
• Keep the calendar's tech sessions accurate.

Required Skills & Qualifications
• Hands-on experience with pro-audio equipment and basic electrical / building maintenance.
• Methodical, safety-minded, keeps records.$JD$)
on conflict (title) do nothing;

select
  (select count(*) from hr_positions) as positions,
  (select count(*) from information_schema.columns where table_name = 'user_profiles' and column_name = 'position_title') as profile_col,
  (select count(*) from information_schema.columns where table_name = 'hr_cases' and column_name in ('position_id','from_position_title','was_supervisory')) as case_cols;
