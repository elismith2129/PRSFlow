-- ─────────────────────────────────────────────────────────────────────────────
-- AP procedures — seed from "Label_Billing Client AP Structure.xlsx" (2026-09).
--
-- Faithful to the sheet, with two deliberate departures:
--   1. NO PASSWORDS. The sheet's nine plaintext portal logins are not here and
--      must not be added — see the header of 20260908120000_ap_profiles.sql.
--      Login EMAILS are kept; they are how you find the account, not how you
--      get in.
--   2. The sheet's blank rows are inheritance, not missing data. Under UMG only
--      Capitol carried a procedure; the other twelve divisions inherit it, so
--      they all point at the one UMG profile rather than getting empty rows.
--
-- Idempotent: re-running updates the row rather than duplicating it (name is
-- unique). Safe to re-run after editing this file.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.ap_profiles
  (name, family, submission_method, po_required, po_notes, portal_name, portal_url,
   login_email, submit_to, cc_to, payment_method, steps, tips, is_global)
values

-- ── UMG ─────────────────────────────────────────────────────────────────────
-- One procedure for all thirteen divisions. Uniport EXISTS but UMG prefers the
-- submission email — worth stating outright, or someone reasonably assumes the
-- portal is the right channel and waits on a submission nobody is watching.
('Universal Music Group', 'UMG', 'email', true,
 $$A PO must be issued before the invoice is sent. Email the invoice only once the PO is in hand.$$,
 'Uniport', null, 'info@paramountrecording.com',
 'umg.invoice.usa@umusic.com',
 'The admin and the admin coordinator on the booking — both on copy.',
 'ACH',
 $$[
   {"title":"Wait for the PO","detail":"UMG issues a PO per session. Do not send the invoice before it arrives — an invoice without a PO is not payable and will sit."},
   {"title":"Apply the PO to the invoice in QuickBooks","detail":"The PO number must appear on the invoice itself, not only in the email."},
   {"title":"Email the package to umg.invoice.usa@umusic.com","detail":"Invoice PDF + work order. Copy the admin and the admin coordinator from the booking thread."},
   {"title":"Uniport is available but NOT preferred","detail":"We have a Uniport login (info@paramountrecording.com) and invoices can be submitted there, but UMG has told us they prefer the submission email. Use email unless someone at UMG asks otherwise."}
 ]$$::jsonb,
 null, false),

-- ── WMG ─────────────────────────────────────────────────────────────────────
-- Warner Records + Atlantic + 300 + 10k all run through SAP Ariba. The PO Flip
-- walkthrough is the longest procedure we have and the one most worth writing
-- down — it is entirely non-obvious from the Ariba UI.
('Warner Records (SAP Ariba)', 'WMG', 'portal', true,
 $$POs are received inside SAP Ariba. Any additional cost must be approved and the PO updated in SAP, or the invoice will not be paid accurately.$$,
 'SAP Ariba', null, 'info@paramountrecording.com',
 null, null, 'ACH',
 $$[
   {"title":"Log in to SAP Ariba and open Orders","detail":"The overview screen shows \"Orders\" as the second option in the middle. It lists POs issued in the last 90 days; the default view excludes POs already invoiced."},
   {"title":"Click the PO you are invoicing against","detail":"This starts a PO Flip — an Ariba invoice built from the PO. It is SEPARATE from our QuickBooks invoice, which gets attached to it."},
   {"title":"Fill in our invoice number, our invoice date, and the session description","detail":"Session description is artist, room, and date or date range."},
   {"title":"Check the PO amount matches our invoice","detail":"Scroll down and confirm the PO was created for the correct amount. If it does not match, stop and get the PO adjusted — do not submit a mismatch."},
   {"title":"Attach our invoice to the line item","detail":"Tick the line-item checkbox, use the \"Line Item Action\" dropdown just below it, choose \"add attachment\", then CLICK the \"add attachment\" button after choosing the file. Skipping that second click silently drops the upload."},
   {"title":"Click Next, then Submit Invoice","detail":"Confirmation emails arrive at info@ when the submission goes through. If they do not arrive, it did not submit."},
   {"title":"Download the remittance when it comes","detail":"Remittance documents are checked and downloaded from Ariba too."}
 ]$$::jsonb,
 null, false),

('Warner Chappell', 'WMG', 'email', false,
 $$No PO.$$, null, null, null,
 'The admin on the booking email.', null, 'ACH',
 $$[{"title":"Reply on the booking email to the admin","detail":"No PO and no portal — the invoice goes back to the admin on the original booking thread."}]$$::jsonb,
 null, false),

('Warner UK', 'WMG', 'email', true,
 $$PO required.$$, null, null, null,
 'uk_invoices@wmg.com', 'The AR admin.', 'ACH',
 $$[{"title":"Apply the PO, then email uk_invoices@wmg.com","detail":"Copy the AR admin."}]$$::jsonb,
 $$International branch — see the general reference card for the three rules that apply to any international arm of the big three (confirm the responsible admin, put banking details on the invoice itself, ask for a remittance document).$$,
 false),

-- ── Sony ────────────────────────────────────────────────────────────────────
-- Sony is the opposite of UMG: no single house procedure, each label a variant
-- of "send it back to whoever issued the PO". Grouped only where identical.
('Sony — RCA / Columbia', 'Sony', 'email', true,
 $$A PO is issued per session. Apply it before sending.$$, null, null, null,
 'The AR admin AND the admin coordinator who issued the PO for that session.',
 null, 'ACH',
 $$[{"title":"Send to the AR admin and the admin coordinator who issued the PO","detail":"Per session — the right recipients are the ones on that session's PO, not a standing address."}]$$::jsonb,
 null, false),

('Sony — Arista / Alamo', 'Sony', 'email', true,
 $$Apply the PO to the invoice before sending.$$, null, null, null,
 'The admin who issued the PO, plus any other admin from the original thread.',
 null, 'ACH',
 $$[{"title":"Apply the PO","detail":"On the invoice itself."},
    {"title":"Send to the PO issuer and everyone else on the original thread","detail":"Do not drop the other admins — they are on it because they need the paperwork."}]$$::jsonb,
 null, false),

('Sony — Epic Records', 'Sony', 'email', true,
 $$The PO always arrives SEPARATELY from the booking email. Apply it to the invoice before sending.$$,
 null, null, null,
 'Reply-all to the issuer of the PO and any other admin copied on the PO email.',
 null, 'ACH',
 $$[{"title":"Find the PO email — it is not the booking email","detail":"Epic sends the PO on its own thread. This is the step people miss."},
    {"title":"Apply the PO to the invoice before sending","detail":"Not after."},
    {"title":"Reply-all on the PO email","detail":"That thread already has the right admins on it."}]$$::jsonb,
 null, false),

('Sony Music Publishing (SMP)', 'Sony', 'email', false,
 $$No PO.$$, null, null, null,
 'denise.zuba@sonymusicpub.com', null, 'ACH',
 $$[{"title":"Email the invoice to denise.zuba@sonymusicpub.com","detail":"No PO required."}]$$::jsonb,
 null, false),

-- ── Miscellaneous billing clients ───────────────────────────────────────────
('Fox Broadcasting Company LLC', 'Other', 'portal', false,
 $$No PO.$$, 'Graphite', null, 'eli@paramountrecording.com, aaron@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Submit through the Graphite portal","detail":"Eli and Aaron each have their own Graphite login."}]$$::jsonb,
 null, false),

('Concord Music Group', 'Other', 'portal', false,
 $$No PO.$$, 'Graphite', null, 'eli@paramountrecording.com, aaron@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Submit through the Graphite portal","detail":"Same Graphite logins as Fox."}]$$::jsonb,
 null, false),

('Quality Control Music', 'Other', 'portal', false,
 $$No PO.$$, 'SAP / HYBE', null, 'info@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Submit through SAP / HYBE","detail":"Login is info@paramountrecording.com."}]$$::jsonb,
 null, false),

('Gamma', 'Other', 'portal', false,
 $$No PO.$$, 'Tipalti — Gamma', null, 'info@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Open the Gamma Tipalti portal","detail":"Shortcut is in Safari on the front computer. Every Tipalti portal is the same service with its own unique link — make sure it is the GAMMA one."}]$$::jsonb,
 null, false),

('GR Business MGMT', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'srosenberg@grbizmgmt.com, ax@rehpic.xyz',
 'Simon Rosenberg and Alex Rechs.', 'ACH',
 $$[{"title":"Email Simon Rosenberg and Alex Rechs","detail":"⚠ VERIFY THESE ADDRESSES — the source spreadsheet cell ran the name and email together (\"Alex Reschsrosenberg@grbizmgmt.com\"), so the split between the two recipients is an interpretation. Confirm with Aaron before the first send."}]$$::jsonb,
 null, false),

('Broke Records', 'Other', 'form', false,
 $$No PO.$$, 'Monday.com submission form',
 'https://forms.monday.com/forms/12f603bac1ea05d996ca5520f1dee8e1?r=use1',
 null, null, null, 'ACH',
 $$[{"title":"Submit through the Monday.com form","detail":"There is no AP email — the form is the only channel."}]$$::jsonb,
 null, false),

('MNRK', 'Other', 'portal', false,
 $$No PO.$$, 'Tipalti — MNRK', null, 'info@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Open the MNRK Tipalti portal","detail":"Shortcut is on the front computer. Check it is the MNRK link, not Gamma's — the portals look identical."}]$$::jsonb,
 null, false),

('Redbull', 'Other', 'portal', false,
 $$No PO.$$, 'Taulia — Redbull', null, 'info@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Submit through the Taulia invoice portal","detail":null}]$$::jsonb,
 null, false),

('Neon Rated', 'Other', 'portal', false,
 $$No PO.$$, 'Stampli', null, 'info@paramountrecording.com',
 null, null, 'ACH',
 $$[{"title":"Submit through Stampli","detail":"Stampli is both the invoice submission and the AP portal."}]$$::jsonb,
 null, false),

('OVO Sound', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'The booking thread.', 'Greg Moffett — greg@ovosound.com (always).', 'ACH',
 $$[{"title":"Reply on the booking thread with the invoice","detail":"Always include Greg Moffett (greg@ovosound.com)."}]$$::jsonb,
 null, false),

('Guitar Center', 'Other', 'email', true,
 $$Two-pass: send first, then the PO arrives separately and you resend with it applied.$$,
 null, null, null,
 'Gustavo.Lopez@guitarcenter.com, Kaleb.Slack@guitarcenter.com', null,
 'Check in Mail',
 $$[{"title":"First send: email Gustavo and Kaleb","detail":"Gustavo.Lopez@guitarcenter.com and Kaleb.Slack@guitarcenter.com."},
    {"title":"Wait for the PO — it comes separately","detail":"It does not arrive on the booking email."},
    {"title":"Apply the PO and RESEND to both","detail":"The second send is what gets paid. The first one alone will not."}]$$::jsonb,
 $$Pays by CHECK IN THE MAIL, not ACH — the only client on the sheet that does. Do not chase an ACH that is never coming.$$,
 false),

('Empire Records', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'The AR admin who approved the session.', null, 'ACH via Bill.com',
 $$[{"title":"Send to the AR admin who approved the session","detail":"Payment arrives through Bill.com."}]$$::jsonb,
 null, false),

('Roc Nation', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'rndap@rocnation.com', 'The A/R admin.', 'ACH',
 $$[{"title":"Email rndap@rocnation.com","detail":"Copy the A/R admin."}]$$::jsonb,
 null, false),

('Top Dawg Entertainment (TDE)', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'saj@txdxe.com, angela@txdxe.com',
 'The A/R who booked the session — on the thread.', 'ACH',
 $$[{"title":"Email AP: saj@txdxe.com and angela@txdxe.com","detail":"Include the A/R who booked the session on the thread."}]$$::jsonb,
 null, false),

('Young Stoner Life', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'halle@theogunlesigroup.com',
 'Management and the A/R who booked the session.', 'ACH / WIRE',
 $$[{"title":"Email halle@theogunlesigroup.com","detail":"Include management and the A/R who booked the session."}]$$::jsonb,
 null, false),

('Dark Room Records', 'Other', 'email', false,
 $$No PO.$$, null, null, null,
 'sacha@thedarkroomco.com, thedarkroomteam@lcbmco.com', null, 'ACH via Bill.com',
 $$[{"title":"Email both Dark Room addresses","detail":"sacha@thedarkroomco.com and thedarkroomteam@lcbmco.com. Payment arrives through Bill.com."}]$$::jsonb,
 null, false),

('Cecil Park Records', 'Other', 'portal', false,
 $$No PO.$$, 'Cecil Park AP portal', 'https://ap.cecilparkrecords.com',
 'ParamountRecordingStudios', null, null, 'ACH',
 $$[{"title":"Submit on the Cecil Park portal","detail":"https://ap.cecilparkrecords.com — username ParamountRecordingStudios."}]$$::jsonb,
 null, false),

-- ── The global reference card ───────────────────────────────────────────────
-- Renders under every label. Not attached to any client.
('General AP reference', 'Global', 'email', false,
 null, null, null, null, null, null, null,
 $$[
   {"title":"Every invoice package is the same three things","detail":"The invoice PDF exported from QuickBooks, the work order, and any receipts — named \"Invoice #XXXXX - Label/Artist\". Session info must be filled in on the work order: some labels will not remit payment without it."},
   {"title":"Tipalti portals are all the same service with different links","detail":"Gamma and MNRK each have their own Tipalti portal. Using the wrong link submits into the wrong tenant. Background: https://tipalti.com/resources/learn/what-is-a-supplier-portal/"},
   {"title":"SAP Ariba background","detail":"https://www.sap.com/about/agreements/sap-supplier-portal/ariba.html"},
   {"title":"Any INTERNATIONAL branch of the big three","detail":"1. Ask the A/R who connected you who the admin responsible for facilitating payment is. 2. Put all banking info directly on the invoice, in a blank space below the line items. 3. Ask their accounting department for a remittance document."},
   {"title":"Abbreviations","detail":"SME = Sony Music Entertainment. SMP = Sony Music Publishing."}
 ]$$::jsonb,
 null, true)

on conflict (name) do update set
  family            = excluded.family,
  submission_method = excluded.submission_method,
  po_required       = excluded.po_required,
  po_notes          = excluded.po_notes,
  portal_name       = excluded.portal_name,
  portal_url        = excluded.portal_url,
  login_email       = excluded.login_email,
  submit_to         = excluded.submit_to,
  cc_to             = excluded.cc_to,
  payment_method    = excluded.payment_method,
  steps             = excluded.steps,
  tips              = excluded.tips,
  is_global         = excluded.is_global,
  updated_at        = now();
