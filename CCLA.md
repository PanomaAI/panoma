# Corporate Contributor License Agreement

**panoma — Corporate Contributor License Agreement (CCLA), v1.1**

This is the agreement for the case the individual one cannot cover: when the person
writing the code does not own it, because their employment contract says the company
does.

Nothing here changes what the Project is. The Corporation keeps the copyright to
everything its people write — this is a licence, not a transfer — and section 4 is the
same promise back that the individual agreement makes: everything contributed stays
available under its free licence, as a term of this contract, with consequences if that
is ever broken.

If you are contributing your own work, you want [`CLA.md`](CLA.md) instead. This one is
signed by someone with authority to bind the company, not by the engineer.

---

## 1. Definitions

**"Corporation"** means the legal entity signing this agreement, and every entity that
controls it, is controlled by it, or is under common control with it. Control means
owning more than 50% of the shares, or the power to direct its management.

**"You"** means the Corporation.

**"Project"** means panoma, its source code and documentation — today at
`github.com/panomahq/panoma`, and at whatever repository the Owner designates as
canonical if the hosting ever moves. A move of hosting changes the address, not the
Project and not this agreement.

**"Owner"** means Jesus Castillo, the copyright holder of the Project, and his
successors and assigns. The obligations in section 4 travel with the rights: whoever
holds the licences granted here — a future company, a buyer, an heir — is bound by
section 4 exactly as the Owner is.

**"Contribution"** means any original work of authorship — code, documentation,
translations, configuration, artwork — submitted to the Project by a Designated
Employee, in any form and through any channel. Anything clearly marked in writing as
"Not a Contribution" is excluded.

**"Designated Employee"** means a person listed in Schedule A, as updated under section
6.

**"Submission-Date Licence"** means the free-software licence the Project uses, at the
moment a Contribution is submitted, for the material that Contribution modifies or joins
— today, the AGPL-3.0-only — including any later version of that licence published by
its steward (for the AGPL, the Free Software Foundation).

## 2. Grant of copyright licence

You grant the Owner a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
copyright licence to reproduce, prepare derivative works of, publicly display, publicly
perform, sublicense and distribute each Contribution and such derivative works. This
covers every Contribution: the ones already submitted when the Corporation signed, and
every one submitted after.

**This licence includes the right to sublicense the Contribution under any licence
terms, including terms other than the AGPL-3.0 and including proprietary terms —
always subject to the Owner's obligation in section 4.1.**

That sentence is the reason this document exists, so it is worth stating plainly: it
lets the Owner offer commercial licences to organisations that cannot use AGPL software,
and to build paid products that reuse Project code. What it does not do is let the Owner
take a Contribution out of the free release — section 4 makes that a contractual
obligation, not a courtesy. And the Corporation keeps every right it had before signing,
including the right to use, publish and relicense its own Contributions however it
wishes.

## 3. Grant of patent licence

You grant the Owner and every recipient of the Project a perpetual, worldwide,
non-exclusive, royalty-free, irrevocable patent licence to make, have made, use, offer
to sell, sell, import and otherwise transfer the Project, each Contribution, and any
product or service of the Owner that incorporates a Contribution — and the recipients
and users of any such product or service receive the same licence for it. This applies
only to patent claims the Corporation owns or controls that are necessarily infringed
by a Contribution alone, by its combination with the Project, or by its combination
with the product or service it ships in.

If the Corporation starts patent litigation alleging that the Project, or a Contribution
within it, infringes a patent, the patent licences granted to the Corporation under this
section terminate on the day the action is filed.

## 4. The Owner's obligations to You

This section is what the Corporation gets back. It is a binding contractual obligation
— deliberately an obligation, not a condition on the licences in sections 2 and 3. The
difference is what happens if it ever breaks: a broken condition would turn licences
already granted into infringement overnight; a broken obligation is handled by section
4.2, which is the sole and exclusive remedy for a breach of this section.

### 4.1 The free-software commitment

Whenever the Owner exercises any right granted in section 2 — sublicensing included —
the Owner agrees to also license each Contribution, and to keep it publicly available,
under the Submission-Date Licence. Publishing a Contribution under additional licences
— commercial ones included — never suspends or replaces this obligation: the free copy
exists alongside every other copy, always.

One exception, because the law can force it: removing a Contribution — or the affected
part of one — to comply with a legal obligation or a credible third-party infringement
claim is not a breach of this section, provided the Owner removes no more than is
required and restores what may be restored once the claim is resolved.

In plain words: the Owner may sell exceptions to the AGPL. The Owner may not withdraw
from the commons what the Corporation gave to it.

### 4.2 What happens if that is broken

If the Owner materially breaches section 4.1 with respect to a Contribution and does
not cure the breach within three months of the Corporation's written notice, the
Corporation may terminate the licences it granted in sections 2 and 3 for that
Contribution, effective for the future.

Termination is prospective only. It does not affect: (a) the rights the public has
already received under the Submission-Date Licence, which are irrevocable under that
licence's own terms; (b) sublicences of that Contribution granted to specific third
parties before termination; and (c) the Owner's continued operation of products and
services that already incorporated that Contribution when termination took effect.
What termination ends is the Owner's ability to grant new licences of the Contribution,
and to build new products on it.

### 4.3 Irrevocability of what is already free

For the avoidance of doubt: nothing in this agreement empowers the Owner to revoke,
narrow or encumber the licences the public has already received for any published
version of the Project. A copy released under the AGPL-3.0 stays licensed under the
AGPL-3.0 in the hands of everyone who has it.

## 5. What the Corporation is stating

By signing, the Corporation states that:

1. The person signing has authority to bind the Corporation to this agreement.
2. Each Contribution is an original work of authorship, and the Corporation has the
   right to grant the licences above — because it owns the work, or because it has
   obtained the rights from whoever does.
3. Contributions do not knowingly infringe anyone's rights.
4. Where any part of a Contribution is not the Corporation's own work, it has been
   identified clearly — source, author and licence — in the submission itself, and the
   Corporation is permitted to include it under a licence compatible with the AGPL-3.0.

## 6. Schedule A, and keeping it true

Schedule A lists the people authorised to submit Contributions on the Corporation's
behalf. It is kept in this repository, in the open, in
[`.github/cla-signers.json`](.github/cla-signers.json): each entry under `empresas`
carries the Corporation's name and its list, in the `anexoA` field — the automated check
reads exactly that key.

To add or remove someone, an authorised signer of the Corporation says so in writing to
`support@panoma.ai`, and the change is recorded in that file with the date. The git
history of the file is the record of who was authorised when.

**A submission from someone not on the list is not covered by this agreement.** That is
not a formality: it is the whole point of Schedule A. Anyone at the Corporation who
contributes without being listed will be asked to sign the individual agreement instead,
which they can only do truthfully if the work is genuinely theirs.

## 7. Changed circumstances

If any statement in section 5 stops being accurate, or if the Corporation stops having
the right to grant the licences for a Designated Employee's work, tell the Owner.

## 8. No warranty

Except for the statements in section 5, Contributions are provided "as is", without
warranty of any kind. The Corporation is not expected to provide support for them.

## 9. No obligation

The Owner is under no obligation to accept, merge or use any Contribution.

## 10. Governing law

This agreement is governed by the laws of the State of New York, United States, without
regard to its conflict-of-law rules. If any part of this agreement is found
unenforceable, the rest stays in force.

---

## How to sign

Write to `support@panoma.ai` from a company address, with:

- the Corporation's legal name and address;
- the name, title and signature of someone with authority to bind it;
- the initial Schedule A: the GitHub logins of the people authorised to contribute.

The Owner keeps the signed agreement itself on file, and records the fact — the
Corporation's name, the date and the Schedule A — in
[`.github/cla-signers.json`](.github/cla-signers.json), where it is public and
auditable. From then on, the automated check recognises those logins and their pull
requests do not need an individual signature.

The engineers named in Schedule A do not sign anything themselves — that is the
difference between this agreement and [`CLA.md`](CLA.md), and the reason this one
exists.
