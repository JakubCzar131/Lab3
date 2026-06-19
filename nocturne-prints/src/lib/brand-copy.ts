/**
 * Centralne teksty marki i teksty prawne.
 * Trzymane w jednym miejscu, aby ten sam tekst zgody pokazany klientowi
 * mogl byc zapisany jako snapshot w ConsentLog (zgodnosc / audyt).
 */

export const BRAND = {
  name: "Nocturne Prints",
  tagline: "Nie wybierasz nadruku. Przywołujesz go.",
  subtagline:
    "Personalizowane koszulki i bluzy tworzone przez AI. Efekt pozostaje tajemnicą aż do otwarcia paczki.",
} as const;

export const HERO_COPY = {
  heading: "Nie wybierasz nadruku. Przywołujesz go.",
  lead: "Wrzucasz zdjęcie. Podajesz intencję. Resztę robi algorytm. Każdy nadruk jest jednorazowym rytuałem — nie zobaczysz go, dopóki nie rozedrzesz folii.",
  cta: "Przywołaj nadruk",
  ctaSecondary: "Zobacz, jak to działa",
} as const;

export const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Wybierz nośnik",
    body: "Koszulka albo bluza. Kolor, rozmiar, krój. To jedyne, nad czym masz pełną kontrolę.",
  },
  {
    step: 2,
    title: "Wrzuć zdjęcie",
    body: "Twoje zdjęcie staje się ziarnem projektu. Usuwamy metadane EXIF i sprawdzamy treść.",
  },
  {
    step: 3,
    title: "Podaj intencję",
    body: "Krótki prompt i styl. Mów, co chcesz przywołać — nie kopiujemy marek ani cudzych legend.",
  },
  {
    step: 4,
    title: "AI tworzy niespodziankę",
    body: "Algorytm tworzy projekt. Ty go nie widzisz. To nie błąd — to zasada rytuału.",
  },
  {
    step: 5,
    title: "Drukujemy i wysyłamy",
    body: "Po moderacji projekt trafia do produkcji. Efekt pozostaje tajemnicą aż do otwarcia paczki.",
  },
] as const;

export const SAFETY_SECTION = {
  heading: "Czego NIE przywołamy",
  lead: "Tworzymy Twoją legendę — nie kopiujemy cudzych. Te treści są odrzucane automatycznie lub kierowane do ręcznej weryfikacji.",
  rules: [
    "Marki, logotypy i znaki towarowe (np. Nike, Adidas, Apple).",
    "Chronione postacie i franczyzy (np. Disney, Marvel, Pokémon, Star Wars).",
    "Celebryci, politycy, sportowcy i osoby publiczne bez zgody.",
    "Styl konkretnych, żyjących artystów lub konkretnych studiów.",
    "Treści nienawistne, ekstremistyczne, rasistowskie, symbole zakazane.",
    "Nagość, treści seksualne, a w szczególności cokolwiek z osobami wyglądającymi na nieletnie.",
    "Drastyczna przemoc i gore.",
    "Treści zniesławiające, kompromitujące lub upokarzające realne osoby.",
    "Dane osobowe, doxxing, dokumenty, adresy, numery telefonów.",
    "Podszywanie się pod organizacje, marki, partie, urzędy.",
    "Treści nielegalne lub zachęcające do przestępstwa.",
  ],
  disclaimer:
    "Moderacja jest warstwowa i działa najlepiej, jak potrafi — ale nie obiecujemy, że wychwyci 100% naruszeń. W razie wątpliwości zamówienie trafia do ręcznej weryfikacji, a nie do druku.",
} as const;

export const LEGAL_COPY = {
  personalizedMystery: {
    title: "Produkt personalizowany typu „mystery”",
    body: "Każdy produkt jest tworzony indywidualnie na Twoje zamówienie, na podstawie przesłanego zdjęcia i opisu. To nie jest produkt z półki — to jednorazowy projekt generowany przez algorytm.",
  },
  noPreview: {
    title: "Brak podglądu przed drukiem",
    body: "Z założenia nie pokazujemy finalnego projektu przed wydrukiem. To istota usługi „mystery print”. Składając zamówienie, akceptujesz, że odbierasz niespodziankę.",
  },
  noWithdrawal: {
    title: "Brak zwrotu z powodu zmiany zdania",
    body: "Ponieważ produkt jest personalizowany i tworzony specjalnie dla Ciebie, zgodnie z prawem nie podlega zwrotowi z powodu zmiany zdania (odstąpienia od umowy na zasadach ogólnych).",
  },
  complaintRights: {
    title: "Prawo do reklamacji wad",
    body: "Zachowujesz pełne prawo do reklamacji wad produktu — np. błędów druku, uszkodzeń, wad materiału czy niezgodności z zamówionym rozmiarem/kolorem. Reklamacje rozpatrujemy zgodnie z obowiązującym prawem.",
  },
  imageRights: {
    title: "Prawa do zdjęć i wizerunku",
    body: "Przesyłając zdjęcie oświadczasz, że masz do niego prawa oraz zgody wszystkich widocznych na nim osób na wykorzystanie ich wizerunku. Odpowiedzialność za treść przesłanego materiału spoczywa po stronie zamawiającego.",
  },
  uploadWarning: {
    title: "Zanim wrzucisz zdjęcie",
    body: "Nie wysyłaj zdjęć z markami, logotypami, chronionymi postaciami, osobami publicznymi bez zgody ani treści naruszających prawo. Usuwamy metadane EXIF, ale moderacja nie jest doskonała — uczciwość treści jest po Twojej stronie.",
  },
  rejectionNotice: {
    title: "Twoje zamówienie zostało odrzucone",
    body: "Po weryfikacji uznaliśmy, że zamówienie narusza nasze zasady bezpieczeństwa treści lub prawa osób trzecich. Jeśli płatność została pobrana, zwracamy ją zgodnie z regulaminem. W razie pytań skontaktuj się z nami.",
  },
} as const;

/**
 * Definicje wymaganych zgod (checkboxy w konfiguratorze).
 * `text` jest zapisywany jako snapshot w ConsentLog.
 */
export const CONSENT_DEFINITIONS = [
  {
    type: "image_rights" as const,
    required: true,
    text: "Potwierdzam, że mam prawa do przesłanego zdjęcia oraz zgody wszystkich widocznych na nim osób na wykorzystanie ich wizerunku.",
  },
  {
    type: "mystery_no_preview" as const,
    required: true,
    text: "Rozumiem, że zamawiam produkt personalizowany typu „mystery” i nie zobaczę finalnego projektu przed drukiem.",
  },
  {
    type: "creative_variation" as const,
    required: true,
    text: "Rozumiem, że efekt pracy AI może kreatywnie różnić się od moich oczekiwań.",
  },
  {
    type: "no_withdrawal_personalized" as const,
    required: true,
    text: "Rozumiem, że produkt personalizowany nie podlega zwrotowi z powodu zmiany zdania, ale zachowuję prawo do reklamacji wad.",
  },
  {
    type: "face_likeness" as const,
    required: false, // wymagane warunkowo, gdy wykryto twarz na zdjeciu
    text: "Wyrażam zgodę na wykorzystanie wizerunku osoby widocznej na zdjęciu i potwierdzam, że posiadam jej zgodę.",
  },
] as const;

export const FAQ = [
  {
    q: "Czy zobaczę projekt przed drukiem?",
    a: "Nie. To istota „mystery print” — efekt pozostaje tajemnicą aż do otwarcia paczki. Masz wpływ na nośnik, kolor, rozmiar, styl i intencję, ale nie na podgląd finału.",
  },
  {
    q: "Czy mogę zwrócić produkt, bo mi się nie podoba?",
    a: "Produkt jest personalizowany, więc nie podlega zwrotowi z powodu zmiany zdania. Zawsze możesz jednak złożyć reklamację, jeśli produkt ma wadę (np. błąd druku czy uszkodzenie).",
  },
  {
    q: "Jakie zdjęcia mogę wrzucić?",
    a: "Tylko takie, do których masz prawa i zgody widocznych osób. Bez marek, logotypów, chronionych postaci, osób publicznych bez zgody i treści naruszających prawo.",
  },
  {
    q: "Co się dzieje z moim zdjęciem?",
    a: "Usuwamy metadane EXIF, sprawdzamy treść warstwowym systemem moderacji i wykorzystujemy zdjęcie wyłącznie do stworzenia Twojego projektu.",
  },
  {
    q: "Czy AI skopiuje styl mojego ulubionego artysty albo markę?",
    a: "Nie. Nie kopiujemy marek, postaci, celebrytów ani stylu konkretnych, żyjących artystów. Tworzymy oryginalny projekt zainspirowany Twoją intencją.",
  },
  {
    q: "Co jeśli moje zamówienie zostanie odrzucone?",
    a: "Jeśli treść narusza zasady, zamówienie zostaje odrzucone, a płatność (jeśli pobrana) zwrócona zgodnie z regulaminem. O decyzji poinformujemy mailowo.",
  },
  {
    q: "Jak długo czekam na zamówienie?",
    a: "Po opłaceniu zamówienie przechodzi moderację i generowanie, następnie trafia do produkcji i wysyłki. Status śledzisz na stronie zamówienia.",
  },
] as const;

export const BRAND_LINES = [
  "Wrzucasz zdjęcie. Podajesz intencję. Resztę robi algorytm.",
  "Każdy nadruk jest jednorazowym rytuałem.",
  "Nie kopiujemy marek, postaci ani cudzych legend. Tworzymy Twoją.",
  "Efekt pozostaje tajemnicą aż do otwarcia paczki.",
] as const;
