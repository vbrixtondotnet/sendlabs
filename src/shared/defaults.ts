/** Starting point for a new campaign. Uses the supported merge fields and the required unsubscribe link. */
export const DEFAULT_HTML_BODY = `<p>Hi {{firstName}},</p>
<p>I noticed {{companyName}} may still be running critical processes on Microsoft Access. We help teams move those databases to SQL Server or Azure without disrupting day-to-day work, and keep QuickBooks connected throughout.</p>
<p>Would a short call next week make sense?</p>
<p>Best regards,<br/>IT Impact Team</p>
<hr/>
<p style="font-size:12px;color:#666">You received this because your address is on our business contact list.
<a href="{{unsubscribeUrl}}">Unsubscribe</a><br/>IT Impact Inc., 123 Example Street, Sample City</p>`;
