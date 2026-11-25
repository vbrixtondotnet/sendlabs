/**
 * Credits: what a person spends to reveal a global contact's email address on the People page (by adding them to their
 * contacts). Buying more credits is not built yet; for now every user starts with the same free balance.
 */

/** What every user starts with (and what existing users were given when credits were introduced). */
export const STARTING_CREDITS = 100;

/** What revealing one global contact costs. One flat price for now. */
export const PERSON_REVEAL_COST = 1;

/** What adding a hiring company's contact person to your contacts costs, charged only when a contact is found and added. */
export const COMPANY_CONTACT_COST = 1;

/** What finding a job's contact email address (Get Email Address in the Apply panel) costs, charged only when an address is found. */
export const CONTACT_LOOKUP_COST = 10;
