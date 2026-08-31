/**
 * With which rows the accounts and links editor is opened.
 *
 * It lives here, and not inside the component, for the same reason as `account-url.ts`: it can be
 * tested. The tests on this website do not set up React or transform `.tsx` —this is on purpose,
 * not a deficiency—, so a rule that only exists inside `.tsx` has no one to defend it.
 *
 * What it fixes: 'points to the first' opened the editor with the list as it was, and it was empty
 * —which is exactly the case that that button names—, so the form would appear without a single
 * field. Three buttons and no space to write. It was seen using the app.
 */

export interface AccountEntry {
  label: string;
  url?: string;
  email?: string;
  note?: string;
}

/**
 * The two halves weigh the same: without a line there is nowhere to write, and one extra line on a
 * list that already exists is noise that someone has to erase by hand.
 */
export function rowsToEdit(current: AccountEntry[]): AccountEntry[] {
  return current.length > 0 ? current : [{ label: "" }];
}
