// Sierra Leone Connect — shared vocabulary
export const APP_NAME = 'Sierra Leone Connect';

export const DISTRICTS = [
  'Western Area Urban (Freetown)', 'Western Area Rural', 'Bo', 'Bonthe', 'Moyamba', 'Pujehun',
  'Kenema', 'Kailahun', 'Kono', 'Bombali', 'Falaba', 'Koinadugu', 'Tonkolili', 'Kambia',
  'Karene', 'Port Loko'
];

export const REGIONS = {
  'Western Area Urban (Freetown)': 'Western', 'Western Area Rural': 'Western',
  Bo: 'Southern', Bonthe: 'Southern', Moyamba: 'Southern', Pujehun: 'Southern',
  Kenema: 'Eastern', Kailahun: 'Eastern', Kono: 'Eastern',
  Bombali: 'North East', Falaba: 'North East', Koinadugu: 'North East', Tonkolili: 'North East',
  Kambia: 'North West', Karene: 'North West', 'Port Loko': 'North West'
};

export const HERITAGE = [
  'Temne', 'Mende', 'Limba', 'Kono', 'Krio', 'Fula', 'Mandingo', 'Loko', 'Sherbro', 'Susu',
  'Kissi', 'Yalunka', 'Kuranko', 'Vai', 'Gola', 'Kru', 'Mixed', 'Other'
];

export const FAITHS = ['Muslim', 'Christian', 'Spiritual', 'Other', 'Prefer not to say'];

export const LANGUAGES = ['Krio', 'English', 'Mende', 'Temne', 'Limba', 'Fula', 'Mandingo', 'Kono', 'Sherbro', 'French', 'Other'];

export const INTENTS = [
  { id: 'marriage', label: 'Marriage-minded', short: 'Marriage', icon: '💍' },
  { id: 'serious', label: 'Long-term relationship', short: 'Long-term', icon: '❤️' },
  { id: 'open', label: 'Dating, open to see', short: 'Open', icon: '✨' },
  { id: 'friends', label: 'New friends & community', short: 'Friends', icon: '🤝' }
];
export const intentById = id => INTENTS.find(i => i.id === id) || INTENTS[2];

export const INTERESTS = [
  'Jollof & cassava leaf', 'Afrobeats', 'Afropop', 'Gospel', 'Leone Stars football', 'Premier League',
  'Cooking', 'Travel', 'Beaches (Tokeh, River No. 2)', 'Business', 'Tech', 'Fashion', 'Ashobi & lappa style',
  'Church', 'Mosque', 'Fitness', 'Dancing', 'Movies', 'Nollywood', 'Reading', 'Photography',
  'Volunteering', 'Diaspora events', 'Comedy', 'Nature walks', 'Music production', 'Entrepreneurship',
  'Family time', 'Gaming', 'Art', 'Poetry', 'Nursing & healthcare', 'Education', 'Investing'
];

export const PROMPTS = [
  'Di way to my heart na…',
  'My favourite Salone dish na…',
  'My ideal Sunday look like…',
  'I go know say we go match if…',
  'Green flag I de look for…',
  'My hometown na… and you go love am because…',
  'One ting I wan do before next Independence Day…',
  'Wetin mek me laugh pass…',
  'Me and my family…',
  'Best Salone song of all time…',
  'If we go Freetown together, first stop na…',
  'A non-negotiable for me…'
];

export const ICEBREAKERS = [
  'Kushɛ! How di body? 😊',
  'Na which side for Salone you come from?',
  'Cassava leaf or potato leaf — choose wisely 😄',
  'Your profile made me smile. Wetin you de do this weekend?',
  'Lumley Beach or Tokeh Beach?',
  'Who cooks the best jollof in your family?'
];

export const BOT_REPLIES = [
  'Kushɛ! I de fine, tenki 😊 How you de?',
  'Haha I like dat! Tell me more about yourself.',
  'Na true! Me too I love dat.',
  'Wetin you de do for work?',
  'I miss home food so much. Who de cook for you?',
  'We should talk more — you seem nice ✨',
  'Ehh! You funny o 😂'
];

// Cities with coordinates (lat, lng) — used for distance when GPS is not shared
export const CITIES = [
  { city: 'Freetown', country: 'Sierra Leone', lat: 8.484, lng: -13.234 },
  { city: 'Bo', country: 'Sierra Leone', lat: 7.964, lng: -11.739 },
  { city: 'Kenema', country: 'Sierra Leone', lat: 7.877, lng: -11.19 },
  { city: 'Makeni', country: 'Sierra Leone', lat: 8.881, lng: -12.044 },
  { city: 'Koidu', country: 'Sierra Leone', lat: 8.641, lng: -10.971 },
  { city: 'Port Loko', country: 'Sierra Leone', lat: 8.766, lng: -12.787 },
  { city: 'Waterloo', country: 'Sierra Leone', lat: 8.338, lng: -13.07 },
  { city: 'London', country: 'United Kingdom', lat: 51.507, lng: -0.128 },
  { city: 'Manchester', country: 'United Kingdom', lat: 53.48, lng: -2.242 },
  { city: 'Birmingham', country: 'United Kingdom', lat: 52.486, lng: -1.89 },
  { city: 'Washington, DC', country: 'United States', lat: 38.907, lng: -77.037 },
  { city: 'Silver Spring, MD', country: 'United States', lat: 38.991, lng: -77.026 },
  { city: 'New Carrollton, MD', country: 'United States', lat: 38.969, lng: -76.88 },
  { city: 'Alexandria, VA', country: 'United States', lat: 38.805, lng: -77.047 },
  { city: 'Baltimore, MD', country: 'United States', lat: 39.29, lng: -76.612 },
  { city: 'Philadelphia, PA', country: 'United States', lat: 39.953, lng: -75.165 },
  { city: 'New York, NY', country: 'United States', lat: 40.713, lng: -74.006 },
  { city: 'Atlanta, GA', country: 'United States', lat: 33.749, lng: -84.388 },
  { city: 'Houston, TX', country: 'United States', lat: 29.76, lng: -95.37 },
  { city: 'Dallas, TX', country: 'United States', lat: 32.777, lng: -96.797 },
  { city: 'Minneapolis, MN', country: 'United States', lat: 44.978, lng: -93.265 },
  { city: 'Los Angeles, CA', country: 'United States', lat: 34.052, lng: -118.244 },
  { city: 'Toronto', country: 'Canada', lat: 43.653, lng: -79.383 },
  { city: 'Ottawa', country: 'Canada', lat: 45.421, lng: -75.697 },
  { city: 'Dublin', country: 'Ireland', lat: 53.35, lng: -6.26 },
  { city: 'Amsterdam', country: 'Netherlands', lat: 52.368, lng: 4.904 },
  { city: 'Brussels', country: 'Belgium', lat: 50.85, lng: 4.352 },
  { city: 'Paris', country: 'France', lat: 48.857, lng: 2.352 },
  { city: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.405 },
  { city: 'Hamburg', country: 'Germany', lat: 53.551, lng: 9.993 },
  { city: 'Stockholm', country: 'Sweden', lat: 59.329, lng: 18.069 },
  { city: 'Accra', country: 'Ghana', lat: 5.604, lng: -0.187 },
  { city: 'Lagos', country: 'Nigeria', lat: 6.524, lng: 3.379 },
  { city: 'Monrovia', country: 'Liberia', lat: 6.301, lng: -10.797 },
  { city: 'Conakry', country: 'Guinea', lat: 9.641, lng: -13.578 },
  { city: 'Banjul', country: 'Gambia', lat: 13.454, lng: -16.579 },
  { city: 'Dubai', country: 'United Arab Emirates', lat: 25.205, lng: 55.271 },
  { city: 'Melbourne', country: 'Australia', lat: -37.814, lng: 144.963 },
  { city: 'Sydney', country: 'Australia', lat: -33.869, lng: 151.209 },
  { city: 'Beijing', country: 'China', lat: 39.904, lng: 116.407 }
];

export const COUNTRY_FLAGS = {
  'Sierra Leone': '🇸🇱', 'United Kingdom': '🇬🇧', 'United States': '🇺🇸', Canada: '🇨🇦', Ireland: '🇮🇪',
  Netherlands: '🇳🇱', Belgium: '🇧🇪', France: '🇫🇷', Germany: '🇩🇪', Sweden: '🇸🇪', Ghana: '🇬🇭',
  Nigeria: '🇳🇬', Liberia: '🇱🇷', Guinea: '🇬🇳', Gambia: '🇬🇲', 'United Arab Emirates': '🇦🇪',
  Australia: '🇦🇺', China: '🇨🇳'
};
export const flagOf = c => COUNTRY_FLAGS[c] || '🌍';

export const REPORT_REASONS = [
  'Asking for money / scam', 'Fake profile or photos', 'Harassment or hate', 'Inappropriate content',
  'Underage', 'Married / not single', 'Spam or advertising', 'Other'
];

export const DEFAULT_SETTINGS = {
  dailyLikes: 50,
  dailySuperLikes: 3,
  scamShield: true,
  minAge: 18,
  maintenance: false,
  announcement: '',
  requireAdminMfa: true,
  undoEnabled: true
};

export const DECK_MODES = [
  { id: 'worldwide', label: 'Worldwide', icon: '🌍' },
  { id: 'near', label: 'Near me', icon: '📍' },
  { id: 'salone', label: 'In Salone', icon: '🇸🇱' },
  { id: 'diaspora', label: 'Diaspora', icon: '✈️' }
];

// ─────────── Compatibility questions (OkCupid-style) ───────────
// Each member answers for themselves, picks which answers they'd accept from a match,
// and how much it matters. tag = short label used in "You agree on …" reasons.
export const IMPORTANCE = [
  { w: 0, label: 'Irrelevant' }, { w: 1, label: 'A little' }, { w: 10, label: 'Somewhat' },
  { w: 50, label: 'Very' }, { w: 250, label: 'Dealbreaker' }
];
export const Q_CATS = ['Faith & values', 'Family', 'Salone & diaspora', 'Lifestyle', 'Love & relationships'];
export const QUESTIONS = [
  // Faith & values
  { id: 'faith_role', cat: 0, tag: 'Faith', core: true, text: 'How big a part does faith play in your daily life?', opts: ['It guides everything', 'Important', 'Somewhat', 'Not really'] },
  { id: 'interfaith', cat: 0, tag: 'Interfaith', core: true, text: 'Would you marry someone of a different faith?', opts: ['Yes', 'Only if they respect mine', 'No'] },
  { id: 'worship_together', cat: 0, tag: 'Worship', text: 'Should your partner go to church or mosque with you?', opts: ['Yes, regularly', 'Sometimes', 'Not necessary'] },
  { id: 'honesty', cat: 0, tag: 'Honesty', text: 'Is a small lie OK to protect your partner\'s feelings?', opts: ['Yes', 'Sometimes', 'Never'] },
  { id: 'ambition', cat: 0, tag: 'Ambition', text: 'How ambitious should your partner be?', opts: ['Very — building big things', 'Steady and hardworking', 'Content with a simple life'] },
  { id: 'polygamy', cat: 0, tag: 'One partner', core: true, text: 'Would you be open to a polygamous marriage?', opts: ['No, never', 'Open to discussing', 'Yes'] },
  // Family
  { id: 'kids_want', cat: 1, tag: 'Children', core: true, text: 'Do you want children?', opts: ['Yes', 'Maybe', 'No', 'I have kids and want more', 'I have kids, no more'] },
  { id: 'kids_count', cat: 1, tag: 'Family size', text: 'Ideally, how many children?', opts: ['1–2', '3–4', '5 or more', 'None'] },
  { id: 'family_say', cat: 1, tag: 'Family blessing', core: true, text: 'How much should family influence who you marry?', opts: ['Their blessing is essential', 'Their opinion matters', 'It\'s my decision'] },
  { id: 'extended_family', cat: 1, tag: 'Extended family', text: 'Would you live with or financially support extended family?', opts: ['Yes, absolutely', 'If needed', 'Prefer not'] },
  { id: 'put_stone', cat: 1, tag: 'Tradition', text: 'A traditional "put stone" engagement is…', opts: ['A must', 'Nice to have', 'Not important'] },
  { id: 'provider', cat: 1, tag: 'Provider roles', text: 'Who should be the main provider?', opts: ['The man', 'Both equally', 'Whoever earns more'] },
  { id: 'chores', cat: 1, tag: 'Housework', text: 'How should housework be shared?', opts: ['Equally', 'Mostly the woman', 'Mostly the man', 'Hire help'] },
  // Salone & diaspora
  { id: 'move_home', cat: 2, tag: 'Moving home', core: true, text: 'Would you move back to Sierra Leone someday?', opts: ['Yes, definitely', 'Maybe', 'Part-time', 'No', 'I already live in Salone'] },
  { id: 'relocate', cat: 2, tag: 'Relocating', core: true, text: 'Would you relocate for the right person?', opts: ['Yes, anywhere', 'Within my country', 'No'] },
  { id: 'long_distance', cat: 2, tag: 'Long distance', core: true, text: 'Are you open to long distance at first?', opts: ['Yes', 'For a short while', 'No'] },
  { id: 'visit_home', cat: 2, tag: 'Visiting home', text: 'How often would you visit home?', opts: ['Every year', 'Every few years', 'Rarely', 'I live in Salone'] },
  { id: 'kids_language', cat: 2, tag: 'Language for kids', text: 'Should your kids speak Krio or a local language?', opts: ['Yes, essential', 'Nice to have', 'Not important'] },
  { id: 'culture', cat: 2, tag: 'Culture', text: 'How big a part of your life is Salone culture?', opts: ['Huge — food, music, events', 'Some', 'Not much'] },
  // Lifestyle
  { id: 'alcohol', cat: 3, tag: 'Drinking', text: 'Do you drink alcohol?', opts: ['Never', 'Socially', 'Regularly'] },
  { id: 'smoke', cat: 3, tag: 'Smoking', text: 'Do you smoke?', opts: ['Never', 'Sometimes', 'Yes'] },
  { id: 'weekend', cat: 3, tag: 'Weekends', text: 'Your ideal weekend?', opts: ['Out with friends', 'Home with family', 'Church / mosque & community', 'Travelling & exploring'] },
  { id: 'money', cat: 3, tag: 'Money', text: 'Money in a marriage should be…', opts: ['Fully joint', 'Separate', 'A mix of both'] },
  { id: 'job_stable', cat: 3, tag: 'Stability', text: 'How important is it that your partner has a stable income?', opts: ['Very', 'Somewhat', 'Not important'] },
  { id: 'fitness', cat: 3, tag: 'Health', text: 'How important is fitness and health to you?', opts: ['Very — I train often', 'I try to stay active', 'Not a priority'] },
  { id: 'night_owl', cat: 3, tag: 'Body clock', text: 'Morning person or night owl?', opts: ['Early bird', 'Night owl', 'Depends on the day'] },
  // Love & relationships
  { id: 'marry_when', cat: 4, tag: 'Marriage timing', core: true, text: 'When would you like to be married?', opts: ['Within a year', 'In 1–3 years', 'Someday', 'Not sure / not for me'] },
  { id: 'texting', cat: 4, tag: 'Communication', text: 'How much do you like to talk when dating?', opts: ['All day', 'A few times a day', 'Once a day', 'When we can'] },
  { id: 'love_lang', cat: 4, tag: 'Love language', text: 'What makes you feel most loved?', opts: ['Kind words', 'Quality time', 'Gifts', 'Acts of service', 'Physical touch'] },
  { id: 'conflict', cat: 4, tag: 'Handling conflict', text: 'When you argue, you prefer to…', opts: ['Talk it out right away', 'Cool down, then talk', 'Let it pass'] },
  { id: 'opp_friends', cat: 4, tag: 'Trust', text: 'Is it OK for your partner to have close friends of the opposite sex?', opts: ['Yes', 'Depends', 'No'] },
  { id: 'first_date_pay', cat: 4, tag: 'First dates', text: 'Who pays on the first date?', opts: ['The man', 'Whoever asked', 'We split'] },
  { id: 'social_media', cat: 4, tag: 'Privacy', text: 'Would you post your relationship on social media?', opts: ['Yes, proudly', 'A little', 'Keep it private'] },
  { id: 'phone_check', cat: 4, tag: 'Phone privacy', text: 'Is it OK for partners to check each other\'s phones?', opts: ['Yes, nothing to hide', 'Only if asked', 'No'] }
];
export const qById = id => QUESTIONS.find(q => q.id === id);

// ─────────── Chat game: Salone This or That ───────────
export const THIS_OR_THAT = [
  ['Jollof rice', 'Cassava leaf'], ['Lumley Beach', 'Tokeh Beach'], ['Afrobeats', 'Gospel'], ['Freetown', 'Bo'],
  ['Poda-poda', 'Okada'], ['Groundnut soup', 'Okra soup'], ['Beach day', 'Family lunch'], ['Text', 'Voice note'],
  ['Early morning', 'Late night'], ['Fry fish', 'Roast meat'], ['Ginger beer', 'Bissap'], ['Big wedding', 'Small wedding'],
  ['Movie night', 'Dancing'], ['Rice every day', 'Something new'], ['Plan everything', 'Go with the flow'], ['Cook together', 'Eat out'],
  ['Mountains', 'Sea'], ['Football', 'Music'], ['Save', 'Spend'], ['Krio', 'English']
];
