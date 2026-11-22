-- The email signature is written in a rich-text editor now, so it is stored as HTML. Signatures saved before this were
-- plain text: turn each one into the same text as a single HTML paragraph (escaped, line breaks kept), so it looks
-- exactly as it did. Empty signatures stay empty.
UPDATE `campaigns`
SET `signature` = '<p>' ||
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    TRIM(`signature`, ' ' || char(9) || char(10) || char(13)),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;'),
    char(13) || char(10), '<br/>'),
    char(10), '<br/>'),
    char(13), '<br/>')
  || '</p>'
WHERE TRIM(`signature`, ' ' || char(9) || char(10) || char(13)) <> '';
