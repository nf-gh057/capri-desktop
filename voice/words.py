# Her lines as she says them: numbers, times, percentages, versions and letters written out as words, in her
# language, before the model reads them (Chatterbox reads "21:30", "3,5" or a lone "L" as noise).
import re

try:
    from num2words import num2words
except ImportError:  # an older voice setup: digits stay digits
    num2words = None

# Polish letter names, for a letter on its own ("L" -> "El") and for acronyms with no vowel to read them by
# ("PC" -> "pe ce"). Not A, E, I, O, U, W, Z: on their own those are Polish words ("A ty?", "W domu", "Z tobą").
PL_LETTERS = {
    'A': 'a', 'B': 'be', 'C': 'ce', 'D': 'de', 'E': 'e', 'F': 'ef', 'G': 'gie', 'H': 'ha', 'I': 'i', 'J': 'jot',
    'K': 'ka', 'L': 'el', 'M': 'em', 'N': 'en', 'O': 'o', 'P': 'pe', 'Q': 'ku', 'R': 'er', 'S': 'es', 'T': 'te',
    'U': 'u', 'V': 'fał', 'W': 'wu', 'X': 'iks', 'Y': 'igrek', 'Z': 'zet', 'Ł': 'eł',
}
PL_WORDS = set('AEIOUWZ')
# acronyms with vowels that are still spelled out, and a few said their own way
PL_SPELLED = {'AI', 'GPU', 'CPU', 'USB', 'API', 'URL', 'HDMI', 'UI', 'IT', 'OS', 'AMD', 'IP', 'ID'}
PL_SAID = {'OK': 'okej', 'Ok': 'okej'}

VOWELS = set('AEIOUYĄĘÓ')


def say_num(n, lang, to='cardinal'):
    if num2words is None:
        return None
    try:
        return num2words(n, lang=lang if lang in ('pl', 'en') else 'en', to=to)
    except (NotImplementedError, OverflowError, ValueError):
        return None


# Polish ordinals for an hour are feminine, in the case the word before asks for: "jest siódma", "o siódmej",
# "przed siódmą" (num2words gives the masculine: "siódmy", "drugi", "trzeci")
ENDINGS = {
    'a': {'y': 'a', 'gi': 'ga', 'ci': 'cia'},
    'ej': {'y': 'ej', 'gi': 'giej', 'ci': 'ciej'},
    'ą': {'y': 'ą', 'gi': 'gą', 'ci': 'cią'},
}
CASE_AFTER = {'o': 'ej', 'od': 'ej', 'do': 'ej', 'po': 'ej', 'około': 'ej', 'koło': 'ej', 'przed': 'ą', 'za': 'ą',
              'między': 'ą', 'pomiędzy': 'ą'}


def feminine(word, case='a'):
    out = []
    for w in word.split():
        for end in ('gi', 'ci', 'y'):
            if w.endswith(end):
                w = w[:-len(end)] + ENDINGS[case][end]
                break
        out.append(w)
    return ' '.join(out)


def clock(m, lang, before=''):
    h, mins = int(m.group(1)), int(m.group(2))
    if h > 24 or mins > 59:
        return m.group(0)
    if lang == 'pl':
        hour = say_num(h, 'pl', 'ordinal')
        if hour is None:
            return m.group(0)
        hour = feminine(hour, CASE_AFTER.get(before.lower(), 'a')) if h else 'zero'
        if mins == 0:
            return hour
        return f"{hour} {'zero ' if mins < 10 else ''}{say_num(mins, 'pl')}"
    hour = say_num(h, 'en')
    if hour is None:
        return m.group(0)
    if mins == 0:
        return f"{hour} o'clock"
    return f"{hour} {'oh ' if mins < 10 else ''}{say_num(mins, 'en')}"


def version(m, lang):
    dot = ' kropka ' if lang == 'pl' else ' point '
    parts = [say_num(int(p), lang) for p in m.group(0).split('.')]
    return dot.join(parts) if all(parts) else m.group(0)


def decimal(m, lang):
    whole, frac = m.group(1), m.group(2)
    w = say_num(int(whole), lang)
    if w is None:
        return m.group(0)
    mark = ' przecinek ' if lang == 'pl' else ' point '
    # each digit after the mark ("3,05" -> "trzy przecinek zero pięć")
    digits = [say_num(int(d), lang) for d in frac]
    return w + mark + ' '.join(digits)


def integer(m, lang):
    sign, digits = m.group(1), m.group(2).replace(' ', '').replace(' ', '')
    w = say_num(int(digits), lang)
    if w is None:
        return m.group(0)
    return (('minus ' if lang == 'pl' else 'minus ') if sign else '') + w


def letters(m):
    word = m.group(0)
    if word in PL_SAID:
        return PL_SAID[word]
    if len(word) == 1:
        return word if word in PL_WORDS or word not in PL_LETTERS else PL_LETTERS[word].capitalize()
    if word in PL_SPELLED or not (set(word) & VOWELS):
        return ' '.join(PL_LETTERS.get(c, c) for c in word)
    return word  # a word in capitals ("NIE!"), said as a word


def spoken(text, lang):
    lang = 'pl' if lang == 'pl' else 'en'
    t = text
    # a time, with the word before it for its case ("o 7:05" -> "o siódmej zero pięć")
    t = re.sub(r'(?:\b(\w+) )?\b(\d{1,2}):(\d{2})\b',
               lambda m: (f'{m.group(1)} ' if m.group(1) else '') + clock(re.match(r'(\d+):(\d+)', f'{m.group(2)}:{m.group(3)}'), lang, m.group(1) or ''), t)
    t = re.sub(r'\b\d+(?:\.\d+){2,}\b', lambda m: version(m, lang), t)
    t = re.sub(r'(\d)\s?%', lambda m: f"{m.group(1)} {'procent' if lang == 'pl' else 'percent'}", t)
    t = re.sub(r'\b(\d+)[.,](\d+)\b', lambda m: decimal(m, lang), t)
    if lang == 'en':
        t = re.sub(r'\b(\d+)(st|nd|rd|th)\b', lambda m: say_num(int(m.group(1)), 'en', 'ordinal') or m.group(0), t)
    # a minus only before a number on its own ("-5"), not in a range ("3-5")
    t = re.sub(r'(?<!\w)(?:(?<![\w-])(-))?(\d{1,3}(?:[  ]\d{3})+|\d+)\b', lambda m: integer(m, lang), t)
    if lang == 'pl':
        t = re.sub(r'(?<![\w\'’])(?:[A-ZĄĆĘŁŃÓŚŹŻ]{1,5}|Ok)(?![\w\'’])', letters, t)
    return t
