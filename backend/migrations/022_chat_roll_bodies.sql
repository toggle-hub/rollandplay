-- Dice rolls sent from chat used to store the roll's JSON as the message body, replacing the
-- sender's text. The roll has its own column, so those copies are cleared and the chat shows
-- only the roll card.
update chat_messages
set body = ''
where kind = 'roll'
  and roll is not null
  and case when pg_input_is_valid(body, 'jsonb') then body::jsonb = roll else false end;
