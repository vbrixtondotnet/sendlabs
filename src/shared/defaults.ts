/**
 * Starting point for a new campaign's body: just the message. The email signature, the standard unsubscribe
 * footer and the company's postal address are added after it automatically when the email is built.
 */
export const DEFAULT_HTML_BODY = `<p>Hi {{firstName}},</p>
<p>I noticed {{companyName}} may still be running critical processes on Microsoft Access. We help teams move those databases to SQL Server or Azure without disrupting day-to-day work, and keep QuickBooks connected throughout.</p>
<p>Would a short call next week make sense?</p>`;
