# Tester guide — pilot round 1

**This is a test site with made-up data.** Do not enter a real child's details, a real address, or your real phone number. Use numbers like `(718) 555-01xx`. Walk requests delete themselves 72 hours after the walk time; the founder clears the demo after testing.

Test site: `https://walk.savvysolutionpros.com/?o=demo` (demo program, made-up data)
Report problems to: the founder, by email, with a screenshot, the time, your phone model, and the language you had selected.

## Who needs an account

| Role | Account? | How you get in |
|---|---|---|
| Family | No | Open the link. |
| Volunteer | No | Apply on the site. A coordinator approves you and gives you a private check-in link. |
| Coordinator / admin | Yes | The founder adds your email. You sign in with a one-time code sent to that email. |

Coordinator pages are `https://walk.savvysolutionpros.com/c.html?o=demo`. If you see "Sign in through your organization's Cloudflare Access link", your email has not been added yet.

## Round 1 testers

| Tester | Role |
|---|---|
| Test account 1 | Admin (lead) |
| Test account 2 | Coordinator |
| Test account 3 | Volunteer + family (no account) |

## Scripts (about 20 minutes)

### A. Family (phone)
1. Open the link. Check that the "Call 911" button is at the top and dials when tapped.
2. Switch the language to each one you can read. Note any sentence that is wrong, rude, or confusing, especially the safety lines.
3. Find the corners and hours. Tap "Open map".
4. Request a walk: choose a corner, today or tomorrow, a time, a fake callback number, and a language, then tick consent and send.
5. Write down the reference code you are shown.
6. Add the site to your home screen. Turn on airplane mode and open it again: the 911 button and the schedule should still show, with an "offline" notice.

### B. Volunteer
1. On the family page, fill in "Volunteer with us" with a fake name and number. Read the rules and tick the box.
2. Wait for the coordinator to approve you and give you your check-in link. In a real program this happens only after meeting in person.
3. Open the link, check in at a corner, then check out.

### C. Coordinator / admin (computer or tablet)
1. Sign in at the coordinator link with the one-time code from your email.
2. Find tester 3's application and approve them. Copy the check-in link it shows (shown once) and send it to tester 3.
3. Find the walk request from script A. Assign it to **two** approved volunteers. Try to assign only one: it must be refused.
4. Call the family back (use the fake number; don't actually dial it) and mark the request done.
5. Suspend a volunteer: their check-in link must stop working at once.
6. Admin only: check that the admin section is visible to you and not to the coordinator.

## What to report

- Anything that fails, freezes, or shows "null", "undefined" or an error code
- Text running off the screen, or overlapping, especially in Arabic and Urdu (right-to-left)
- Phone numbers or times shown backwards
- Anything that made you unsure what to do next
- Anything that felt like it asked for more personal information than it should
