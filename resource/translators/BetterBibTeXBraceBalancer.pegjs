{
  // pegjs doesn't tolerate unbalanced braces in the parser text
  var lbrace = '{';
  var rbrace = '}';
}

start
  = chunks:chunk* { return chunks.join('') }

chunk
  = t:text+                               { return t.join(''); }
  / l:leftbrace mid:chunk? r:rightbrace   { return l + (mid || '') + r }
  / l:leftbrace mid:chunk?                { return l + "\\vphantom{\\" + rbrace + '}' + (mid || '') }
  / r:rightbrace mid:chunk?               { return "\\vphantom{\\" + lbrace + '}' + r + (mid || '') }

leftbrace
  = "\\{"
  / "\\textleftbrace" [\s]+ /* these two can go as soon as http://tex.stackexchange.com/questions/230750/open-brace-in-bibtex-fields/230754#comment545453_230754 is widely enough available */
  / "\\textleftbrace" &[\\{}]

rightbrace
  = "\\}"
  / "\\textrightbrace" [\s]+ /* these two can go as soon as http://tex.stackexchange.com/questions/230750/open-brace-in-bibtex-fields/230754#comment545453_230754 is widely enough available */
  / "\\textrightbrace" &[\\{}]

text
  = t:[^\\]+ { return t.join(''); }
  / !(leftbrace / rightbrace) t:char { return t; }

char
  = "\\" t:.  { return "\\" + t; }
  / t:.       { return t; }
