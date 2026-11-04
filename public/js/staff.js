// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Shared by the program-staff page (c.html) and the operator console (op.html).
export function note(box, ok, ...n) { box.className = "result " + (ok ? "ok" : "err"); box.replaceChildren(...n.filter((x) => x != null)); }
export const ERR = {
  admin_after_review: "Until the program is reviewed, only the person who signed it up can be an admin. Add this person as a coordinator now; make them an admin after review.",
  too_many_coordinators: "This program has reached its coordinator limit (5 before review, 50 after).",
  too_many_corners: "This program has reached its limit of 50 active corners.", too_many_windows: "This program has reached its limit of 300 published hour blocks.",
  rate_limited: "Too many changes in the last hour. Please wait and try again.", bad_status: "Choose pending or live.", bad_email: "Enter a valid email address.", application_pending: "That person already has a program waiting for review.",
  slug_taken: "That web address is taken. Choose another.", slug_reserved: "That web address is reserved. Choose another.",
  commitments_required: "Please confirm all five commitments.", review_queue_full: "The review queue is full right now. Please try again in a few days or write to the maintainers.",
  cannot_change_own_access: "You cannot change your own access. Another admin must do it.", last_admin: "A program must keep at least one admin.",
  no_coordinator: "That email is not on this program's staff list.", admin_only: "Only a program admin can do this.",
  program_declined: "This program is declined. Approve it first.", demo_program: "The demo program cannot be changed.",
  signin_required: "Your sign-in has ended. Sign in again.", cross_origin: "This request was refused because it did not come from this site.",
};
export async function act(box, fn) { try { await fn(); } catch (e) { note(box, false, ERR[e.code] || "Error: " + e.message); } }

export const BOROUGHS = ["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"];
export const ORG_TYPES = [["nonprofit", "Nonprofit (501(c)(3) or fiscally sponsored)"], ["school_parent_group", "School parent group (PTA/PA)"],
  ["faith", "Faith community"], ["tenant_association", "Tenant or block association"], ["community_board", "Community board / civic group"], ["other", "Other community organization"]];
export const ACKS = [["ack_lead", "We have a named lead and at least one coordinator reachable during our published hours."],
  ["ack_meet_in_person", "We meet every volunteer in person and brief them before approving them."],
  ["ack_rule_of_two", "Walks always go to two approved adults (the software enforces this)."],
  ["ack_not_emergency", "This is not an emergency service: danger means 911, and volunteers never act as police."],
  ["ack_coverage", "We have, or will have before the first shift, liability coverage or a fiscal sponsor."]];
