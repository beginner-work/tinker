# Invite-message template

Paste-ready copy for inviting testers to the private beta. Keep it
personal, conversational, and clear about three things: (1) the link,
(2) which phone number is on the allowlist for them, (3) a soft norm
about not sharing screenshots publicly while it's early. One short
message — don't oversell.

## Short version (Messages / text)

> hey — sharing tinker with you early. it's a quiet writing tool i'm
> building. link: https://**your-domain**/
>
> sign in with the number i'm texting you on — i added it to the
> approved list. let me know what feels off or what you wish were
> there.
>
> just one ask: please don't share screenshots publicly yet while i'm
> shaping it. happy to have you in.

## Slightly longer version (email / DM)

> Hi {Name} —
>
> I've been building tinker for a while: a small, quiet place to
> write a single page about something you're learning. Not a feed,
> not a chat, not a notes app. Just one question at a time, then a
> finished page.
>
> You're on the early list. The link is **https://your-domain/** —
> sign in with your phone (the one I have for you, ending in **…XX**),
> and the six-digit code will land via SMS.
>
> One soft request: while it's still early, please hold off on sharing
> screenshots publicly. Happy if you want to send anyone you think
> would love it my way and I'll add them to the list.
>
> Tell me when something feels broken or wrong — that's what this
> stretch is for.
>
> — Tyler

## Notes for the sender

- Put the **last two digits** of the recipient's phone in `…XX` so
  they confirm "yeah that's me" without you texting a full number
  back.
- Don't post the link or describe the URL in semi-public places
  (group threads, Slack channels with strangers) — keep the URL move
  by move with intentional invites.
- After each invite, add the phone to the LD `signup-enabled` flag's
  Targeting rule in the **Production** environment.
