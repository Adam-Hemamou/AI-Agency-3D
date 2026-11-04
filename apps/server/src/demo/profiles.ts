import type { Insight } from '@agency/shared';

/**
 * Profils de démonstration. TOUT EST FICTIF : créateurs, chaînes, statistiques,
 * adresses (domaine réservé .example) et liens (youtube.example). Toute ressemblance
 * avec une chaîne existante serait fortuite.
 */

const DEMO_SOURCE = 'Données fictives — démonstration';

export const fact = (text: string, source: string = DEMO_SOURCE): Insight => ({
  kind: 'fact',
  text,
  source,
});
export const observation = (text: string): Insight => ({ kind: 'observation', text, source: null });
export const hypothesis = (text: string): Insight => ({ kind: 'hypothesis', text, source: null });

export interface DemoVideo {
  title: string;
  daysBefore: number;
  views: number;
  durationSeconds: number;
  contentType: string;
}

export interface DemoProfile {
  key: string;
  creatorName: string;
  channelName: string;
  handle: string;
  category: string;
  description: string;
  country: string;
  subscribers: number;
  views: number;
  videos: number;
  contactName: string;
  contactEmail: string;
  priority: number;
  keywords: string[];
  discoveryReason: string;
  firstObservation: string;
  missingInfo: string[];
  otherLanguages: string[];
  targetLanguages: string[];
  frequency: string;
  contentTypes: string[];
  recentVideos: DemoVideo[];
  signals: Insight[];
  markets: Insight[];
  adaptable: Insight[];
  trend: Insight;
  strengths: Insight[];
  weaknesses: Insight[];
  opportunities: Insight[];
  risks: Insight[];
  recommendations: string[];
  uncertainties: string[];
  /** Notes sur 10 : international, doublage, régularité, engagement, offre. */
  scores: [number, number, number, number, number];
  summary: string;
  conclusion: string;
  excerpt: { title: string; start: number; end: number; reason: string };
  needs: string[];
}

export const PROFILES = {
  lea: {
    key: 'lea',
    creatorName: 'Léa Martin',
    channelName: 'La Cuisine de Léa',
    handle: 'lacuisinedelea-demo',
    category: 'Cuisine',
    description:
      'Recettes familiales du quotidien, cuisine de saison et astuces anti-gaspillage, filmées dans une petite cuisine lyonnaise.',
    country: 'France',
    subscribers: 184_000,
    views: 21_400_000,
    videos: 312,
    contactName: 'Léa Martin',
    contactEmail: 'contact@cuisine-de-lea.example',
    priority: 3,
    keywords: ['recettes faciles', 'cuisine de saison', 'anti-gaspillage'],
    discoveryReason:
      'Chaîne de cuisine francophone à forte régularité, format pédagogique facilement transposable dans d’autres langues.',
    firstObservation:
      'Vidéos courtes (8 à 12 min), voix off claire et peu de texte incrusté : bon candidat pour le doublage.',
    missingInfo: ['Langues de l’audience', 'Partenariats en cours', 'Adresse de contact vérifiée'],
    otherLanguages: [],
    targetLanguages: ['Anglais', 'Espagnol'],
    frequency: '2 vidéos par semaine',
    contentTypes: ['Recettes pas à pas', 'Menus de la semaine'],
    recentVideos: [
      {
        title: 'Gratin de courge en 20 minutes',
        daysBefore: 3,
        views: 42_000,
        durationSeconds: 640,
        contentType: 'Recette',
      },
      {
        title: 'Mon menu de la semaine à 40 €',
        daysBefore: 7,
        views: 58_000,
        durationSeconds: 900,
        contentType: 'Menu',
      },
    ],
    signals: [],
    markets: [],
    adaptable: [],
    trend: observation('Audience stable sur les trois derniers mois.'),
    strengths: [],
    weaknesses: [],
    opportunities: [],
    risks: [],
    recommendations: [],
    uncertainties: [],
    scores: [6, 7, 8, 6, 7],
    summary: '',
    conclusion: '',
    excerpt: { title: '', start: 0, end: 0, reason: '' },
    needs: [],
  },

  hugo: {
    key: 'hugo',
    creatorName: 'Hugo Bernard',
    channelName: 'Hugo Explore',
    handle: 'hugoexplore-demo',
    category: 'Voyage',
    description:
      'Carnets de voyage à petit budget en Europe et en Asie : itinéraires, coûts réels et conseils pratiques.',
    country: 'France',
    subscribers: 326_000,
    views: 48_900_000,
    videos: 205,
    contactName: 'Hugo Bernard',
    contactEmail: 'pro@hugo-explore.example',
    priority: 4,
    keywords: ['voyage pas cher', 'itinéraire', 'road trip'],
    discoveryReason:
      'Thématique universelle (voyage) et narration en voix off : contenu naturellement international.',
    firstObservation:
      'Plusieurs commentaires en anglais et en espagnol demandent des sous-titres sur les dernières vidéos.',
    missingInfo: ['Répartition géographique de l’audience'],
    otherLanguages: ['Anglais (quelques séquences)'],
    targetLanguages: ['Anglais', 'Espagnol', 'Portugais'],
    frequency: '1 vidéo par semaine',
    contentTypes: ['Carnets de voyage', 'Guides budget'],
    recentVideos: [
      {
        title: 'Japon en 15 jours avec 1 500 €',
        daysBefore: 5,
        views: 210_000,
        durationSeconds: 1_560,
        contentType: 'Carnet de voyage',
      },
      {
        title: 'Portugal : la côte sauvage en van',
        daysBefore: 12,
        views: 165_000,
        durationSeconds: 1_320,
        contentType: 'Carnet de voyage',
      },
    ],
    signals: [],
    markets: [],
    adaptable: [],
    trend: observation('Progression régulière depuis six mois.'),
    strengths: [],
    weaknesses: [],
    opportunities: [],
    risks: [],
    recommendations: [],
    uncertainties: [],
    scores: [8, 8, 7, 8, 8],
    summary: '',
    conclusion: '',
    excerpt: { title: '', start: 0, end: 0, reason: '' },
    needs: [],
  },

  camille: {
    key: 'camille',
    creatorName: 'Camille Roux',
    channelName: 'Science en 5 minutes',
    handle: 'science5min-demo',
    category: 'Vulgarisation scientifique',
    description:
      'Un phénomène scientifique expliqué en cinq minutes, avec des animations maison et un ton accessible.',
    country: 'Belgique',
    subscribers: 512_000,
    views: 73_200_000,
    videos: 268,
    contactName: 'Camille Roux',
    contactEmail: 'camille@science-en-5.example',
    priority: 4,
    keywords: ['vulgarisation', 'science', 'expliqué simplement'],
    discoveryReason:
      'Contenu éducatif intemporel, très demandé à l’international, avec une narration entièrement en voix off.',
    firstObservation:
      'Les animations ne contiennent presque pas de texte : le doublage suffirait à adapter les vidéos.',
    missingInfo: ['Droits sur la musique de fond'],
    otherLanguages: [],
    targetLanguages: ['Anglais', 'Espagnol', 'Allemand'],
    frequency: '1 vidéo par semaine',
    contentTypes: ['Explications animées', 'Questions du public'],
    recentVideos: [
      {
        title: 'Pourquoi le ciel est-il bleu ?',
        daysBefore: 4,
        views: 320_000,
        durationSeconds: 330,
        contentType: 'Explication animée',
      },
      {
        title: 'Comment fonctionne un GPS ?',
        daysBefore: 11,
        views: 280_000,
        durationSeconds: 345,
        contentType: 'Explication animée',
      },
      {
        title: 'Vos questions : les trous noirs',
        daysBefore: 18,
        views: 190_000,
        durationSeconds: 410,
        contentType: 'Questions du public',
      },
    ],
    signals: [
      fact('Narration 100 % en voix off, sans visage à l’écran sur 9 vidéos sur 10.'),
      observation(
        'Des commentaires en anglais réclament une version traduite sur les vidéos récentes.',
      ),
      hypothesis('Une version anglaise pourrait toucher le public scolaire anglophone.'),
    ],
    markets: [
      hypothesis(
        'Marchés anglophones (États-Unis, Royaume-Uni) : forte demande de contenus éducatifs courts.',
      ),
      hypothesis('Amérique latine : public jeune et friand de vulgarisation.'),
    ],
    adaptable: [
      observation(
        'Les vidéos « Pourquoi… ? » sont intemporelles et ne dépendent d’aucune actualité.',
      ),
    ],
    trend: fact('Vues moyennes en hausse de 18 % sur les 3 derniers mois (statistiques fictives).'),
    strengths: [
      fact('Format court et régulier (une vidéo par semaine depuis deux ans).'),
      observation('Ton clair et pédagogique, adapté à tous les âges.'),
    ],
    weaknesses: [
      observation('Les animations contiennent parfois des légendes en français à adapter.'),
    ],
    opportunities: [
      hypothesis('Création d’une chaîne anglaise dédiée à partir du catalogue existant.'),
    ],
    risks: [hypothesis('Concurrence forte des chaînes éducatives anglophones déjà établies.')],
    recommendations: [
      'Proposer un pilote de 3 vidéos doublées en anglais.',
      'Commencer par les vidéos intemporelles les plus vues.',
    ],
    uncertainties: [
      'La répartition réelle de l’audience par pays n’est pas connue (statistiques privées).',
    ],
    scores: [9, 9, 8, 8, 8],
    summary:
      'Chaîne éducative au format court, narration en voix off et contenu intemporel : un profil idéal pour le doublage.',
    conclusion: 'Prospect très prometteur : transmission à Mon bureau recommandée.',
    excerpt: {
      title: 'Pourquoi le ciel est-il bleu ?',
      start: 42,
      end: 92,
      reason: 'Passage en voix off pure, sans texte à l’écran.',
    },
    needs: ['Toucher un public anglophone', 'Rentabiliser un catalogue intemporel'],
  },

  nicolas: {
    key: 'nicolas',
    creatorName: 'Nicolas Petit',
    channelName: 'L’Atelier de Nico',
    handle: 'atelierdenico-demo',
    category: 'Bricolage',
    description:
      'Menuiserie et rénovation pour débutants : projets pas à pas, outils expliqués et erreurs à éviter.',
    country: 'France',
    subscribers: 97_000,
    views: 9_800_000,
    videos: 143,
    contactName: 'Nicolas Petit',
    contactEmail: 'atelier@nico-bois.example',
    priority: 3,
    keywords: ['menuiserie', 'bricolage débutant', 'tuto bois'],
    discoveryReason:
      'Tutoriels très visuels : le geste prime sur la parole, ce qui facilite l’adaptation.',
    firstObservation: 'Plusieurs vidéos sont reprises sur des forums hispanophones de bricolage.',
    missingInfo: ['Taille de l’audience hispanophone'],
    otherLanguages: [],
    targetLanguages: ['Espagnol', 'Anglais'],
    frequency: '2 vidéos par mois',
    contentTypes: ['Tutoriels', 'Présentations d’outils'],
    recentVideos: [
      {
        title: 'Fabriquer une table basse avec 3 planches',
        daysBefore: 6,
        views: 88_000,
        durationSeconds: 1_140,
        contentType: 'Tutoriel',
      },
      {
        title: 'Les 5 outils indispensables pour débuter',
        daysBefore: 20,
        views: 64_000,
        durationSeconds: 780,
        contentType: 'Présentation d’outils',
      },
    ],
    signals: [
      observation(
        'Liens vers ses vidéos repérés sur des forums hispanophones (échantillon fictif).',
      ),
      hypothesis('Une audience hispanophone existe peut-être déjà sans version adaptée.'),
    ],
    markets: [hypothesis('Espagne et Mexique : forte communauté de bricoleurs amateurs.')],
    adaptable: [
      observation('Les tutoriels pas à pas sont compréhensibles avec une simple voix doublée.'),
    ],
    trend: observation('Activité irrégulière : deux pauses de plus d’un mois cette année.'),
    strengths: [observation('Contenu très visuel, peu dépendant de la langue.')],
    weaknesses: [fact('Publication irrégulière (2 interruptions de plus de 4 semaines en 2026).')],
    opportunities: [hypothesis('Marché du bricolage en forte croissance en Amérique latine.')],
    risks: [
      hypothesis('Audience actuelle peut-être trop limitée pour justifier l’investissement.'),
    ],
    recommendations: ['Vérifier l’intérêt réel du public hispanophone avant de proposer l’offre.'],
    uncertainties: ['Aucune donnée fiable sur la part d’audience étrangère.'],
    scores: [6, 8, 5, 7, 6],
    summary:
      'Tutoriels visuels faciles à doubler, mais audience internationale encore incertaine et rythme irrégulier.',
    conclusion: 'Potentiel moyen : à confirmer par une analyse ciblée du public hispanophone.',
    excerpt: { title: '', start: 0, end: 0, reason: '' },
    needs: ['Élargir son audience', 'Monétiser davantage ses tutoriels'],
  },

  sarah: {
    key: 'sarah',
    creatorName: 'Sarah Lefèvre',
    channelName: 'Sarah Fit',
    handle: 'sarahfit-demo',
    category: 'Sport et bien-être',
    description:
      'Séances de sport à la maison sans matériel, programmes de 4 semaines et conseils de récupération.',
    country: 'France',
    subscribers: 640_000,
    views: 112_000_000,
    videos: 389,
    contactName: 'Agence Mouvement (gestion des partenariats)',
    contactEmail: 'partenariats@sarah-fit.example',
    priority: 5,
    keywords: ['sport maison', 'sans matériel', 'programme fitness'],
    discoveryReason:
      'Très forte audience et format « suivez-moi » : un doublage permettrait de toucher des marchés entiers.',
    firstObservation:
      'La créatrice parle face caméra : doublage avec synchronisation labiale à prévoir.',
    missingInfo: [],
    otherLanguages: [],
    targetLanguages: ['Anglais', 'Espagnol', 'Italien'],
    frequency: '3 vidéos par semaine',
    contentTypes: ['Séances guidées', 'Programmes', 'Conseils'],
    recentVideos: [
      {
        title: 'Séance abdos 15 minutes – niveau débutant',
        daysBefore: 2,
        views: 410_000,
        durationSeconds: 960,
        contentType: 'Séance guidée',
      },
      {
        title: 'Programme 4 semaines : semaine 1',
        daysBefore: 9,
        views: 530_000,
        durationSeconds: 1_800,
        contentType: 'Programme',
      },
      {
        title: 'Bien s’étirer après le sport',
        daysBefore: 13,
        views: 260_000,
        durationSeconds: 720,
        contentType: 'Conseils',
      },
    ],
    signals: [
      fact('3 vidéos par semaine depuis 2023.'),
      observation(
        'Les séances guidées sont compréhensibles même sans maîtriser la langue, mais le doublage améliore fortement l’expérience.',
      ),
    ],
    markets: [
      hypothesis('Espagne, Italie et Amérique latine : forte demande de séances à domicile.'),
      hypothesis('Marché anglophone très concurrentiel mais très large.'),
    ],
    adaptable: [observation('Les séances « 15 minutes » sont idéales pour un premier test.')],
    trend: fact('Croissance de 40 000 abonnés par mois en moyenne (statistiques fictives).'),
    strengths: [
      fact('Audience très importante et engagée (taux de commentaires élevé).'),
      observation('Formats courts et répétables.'),
    ],
    weaknesses: [observation('Parle face caméra : la synchronisation labiale est indispensable.')],
    opportunities: [hypothesis('Lancement d’une chaîne hispanophone dédiée.')],
    risks: [hypothesis('Gérée par une agence : cycle de décision plus long.')],
    recommendations: [
      'Préparer une démonstration en espagnol sur une séance courte.',
      'Adresser la proposition à l’agence qui gère les partenariats.',
    ],
    uncertainties: ['Conditions contractuelles de l’agence inconnues.'],
    scores: [9, 7, 10, 9, 8],
    summary: 'Très grosse audience, publication intensive et format universel : priorité haute.',
    conclusion: 'Prospect prioritaire : démonstration de doublage recommandée.',
    excerpt: {
      title: 'Séance abdos 15 minutes – niveau débutant',
      start: 30,
      end: 75,
      reason: 'Consignes claires et rythmées, représentatives du format.',
    },
    needs: ['Conquérir les marchés hispanophones', 'Augmenter les revenus publicitaires'],
  },

  thomas: {
    key: 'thomas',
    creatorName: 'Thomas Garnier',
    channelName: 'TechTalk Thomas',
    handle: 'techtalkthomas-demo',
    category: 'Technologie',
    description:
      'Tests de smartphones et d’ordinateurs, comparatifs et guides d’achat, sans jargon inutile.',
    country: 'Canada (Québec)',
    subscribers: 258_000,
    views: 39_500_000,
    videos: 421,
    contactName: 'Thomas Garnier',
    contactEmail: 'thomas@techtalk.example',
    priority: 4,
    keywords: ['test smartphone', 'comparatif', 'guide d’achat'],
    discoveryReason:
      'Guides d’achat utiles partout dans le monde, audience déjà en partie anglophone.',
    firstObservation: 'Chaîne québécoise : une partie de l’audience est bilingue.',
    missingInfo: [],
    otherLanguages: ['Anglais (titres de quelques vidéos)'],
    targetLanguages: ['Anglais', 'Espagnol'],
    frequency: '2 vidéos par semaine',
    contentTypes: ['Tests', 'Comparatifs', 'Guides d’achat'],
    recentVideos: [
      {
        title: 'Quel ordinateur portable pour les études ?',
        daysBefore: 4,
        views: 150_000,
        durationSeconds: 1_080,
        contentType: 'Guide d’achat',
      },
      {
        title: 'Test complet : le nouveau smartphone pliable',
        daysBefore: 8,
        views: 210_000,
        durationSeconds: 1_260,
        contentType: 'Test',
      },
    ],
    signals: [
      fact('Chaîne basée au Québec, titres parfois bilingues.'),
      observation('Environ un commentaire sur cinq est rédigé en anglais (échantillon fictif).'),
    ],
    markets: [hypothesis('Canada anglophone et États-Unis en priorité.')],
    adaptable: [observation('Les guides d’achat restent pertinents plusieurs mois.')],
    trend: observation('Pics d’audience à chaque sortie de produit majeur.'),
    strengths: [observation('Expertise reconnue et ton accessible.')],
    weaknesses: [observation('Les tests deviennent vite obsolètes.')],
    opportunities: [hypothesis('Version anglaise des guides d’achat de rentrée.')],
    risks: [hypothesis('Marché anglophone de la tech déjà saturé.')],
    recommendations: ['Cibler les guides d’achat plutôt que les tests de produits.'],
    uncertainties: ['Part réelle d’audience anglophone non vérifiée.'],
    scores: [8, 8, 8, 7, 8],
    summary:
      'Créateur tech déjà exposé à l’anglais : transition naturelle vers une version doublée.',
    conclusion: 'Bon potentiel, à orienter vers les contenus durables.',
    excerpt: {
      title: 'Quel ordinateur portable pour les études ?',
      start: 120,
      end: 170,
      reason: 'Passage explicatif, sans référence à une promotion datée.',
    },
    needs: ['Atteindre le marché anglophone nord-américain', 'Valoriser les guides d’achat'],
  },

  ines: {
    key: 'ines',
    creatorName: 'Inès Moreau',
    channelName: 'Inès Beauté Naturelle',
    handle: 'inesbeaute-demo',
    category: 'Beauté',
    description:
      'Cosmétiques maison et routines naturelles, recettes simples avec des ingrédients du quotidien.',
    country: 'France',
    subscribers: 143_000,
    views: 16_700_000,
    videos: 198,
    contactName: 'Inès Moreau',
    contactEmail: 'hello@ines-beaute.example',
    priority: 3,
    keywords: ['cosmétique maison', 'routine naturelle', 'DIY beauté'],
    discoveryReason: 'Niche « beauté naturelle » en forte croissance hors de France.',
    firstObservation: 'Recettes très visuelles, ingrédients facilement trouvables à l’étranger.',
    missingInfo: [],
    otherLanguages: [],
    targetLanguages: ['Anglais', 'Portugais'],
    frequency: '1 vidéo par semaine',
    contentTypes: ['Recettes de cosmétiques', 'Routines'],
    recentVideos: [
      {
        title: 'Baume à lèvres maison en 5 minutes',
        daysBefore: 3,
        views: 76_000,
        durationSeconds: 540,
        contentType: 'Recette',
      },
      {
        title: 'Ma routine du soir 100 % naturelle',
        daysBefore: 10,
        views: 61_000,
        durationSeconds: 780,
        contentType: 'Routine',
      },
    ],
    signals: [observation('Nombreux partages sur des réseaux lusophones (échantillon fictif).')],
    markets: [hypothesis('Brésil : marché de la beauté naturelle très dynamique.')],
    adaptable: [observation('Les recettes courtes sont faciles à doubler.')],
    trend: observation('Audience stable, engagement élevé.'),
    strengths: [observation('Communauté très fidèle.')],
    weaknesses: [observation('Audience plus modeste que d’autres prospects.')],
    opportunities: [hypothesis('Version portugaise pour le marché brésilien.')],
    risks: [hypothesis('Réglementation cosmétique différente selon les pays.')],
    recommendations: ['Proposer d’abord le portugais (Brésil).'],
    uncertainties: ['Taille réelle du public lusophone inconnue.'],
    scores: [7, 8, 7, 9, 7],
    summary: 'Communauté engagée et format visuel : bon candidat pour le marché brésilien.',
    conclusion: 'Prospect intéressant, approche ciblée sur le portugais.',
    excerpt: {
      title: 'Baume à lèvres maison en 5 minutes',
      start: 15,
      end: 60,
      reason: 'Recette complète en moins d’une minute.',
    },
    needs: ['Développer une audience lusophone'],
  },

  julien: {
    key: 'julien',
    creatorName: 'Julien Faure',
    channelName: 'Les Récits de Julien',
    handle: 'recitsdejulien-demo',
    category: 'Histoire',
    description:
      'Grands épisodes de l’histoire racontés comme des récits, avec cartes animées et archives.',
    country: 'France',
    subscribers: 421_000,
    views: 58_300_000,
    videos: 156,
    contactName: 'Julien Faure',
    contactEmail: 'julien@recits-histoire.example',
    priority: 4,
    keywords: ['histoire', 'récit historique', 'documentaire'],
    discoveryReason: 'Narration de grande qualité en voix off, sujets d’intérêt mondial.',
    firstObservation: 'Vidéos longues (25 à 40 min) très regardées jusqu’au bout.',
    missingInfo: [],
    otherLanguages: [],
    targetLanguages: ['Anglais', 'Espagnol'],
    frequency: '2 vidéos par mois',
    contentTypes: ['Récits documentaires', 'Séries thématiques'],
    recentVideos: [
      {
        title: 'La route de la soie racontée en 30 minutes',
        daysBefore: 9,
        views: 380_000,
        durationSeconds: 1_920,
        contentType: 'Récit documentaire',
      },
      {
        title: 'Le grand incendie de Londres',
        daysBefore: 24,
        views: 290_000,
        durationSeconds: 1_680,
        contentType: 'Récit documentaire',
      },
    ],
    signals: [fact('Narration intégralement en voix off.')],
    markets: [hypothesis('Public anglophone et hispanophone friand de documentaires historiques.')],
    adaptable: [observation('Contenus intemporels, aucune référence à l’actualité.')],
    trend: observation('Chaque vidéo continue à générer des vues plusieurs mois après sa sortie.'),
    strengths: [observation('Qualité de narration exceptionnelle.')],
    weaknesses: [observation('Rythme de publication lent (2 vidéos par mois).')],
    opportunities: [hypothesis('Catalogue de 156 vidéos intemporelles à adapter.')],
    risks: [hypothesis('Droits des archives visuelles à vérifier pays par pays.')],
    recommendations: ['Proposer l’adaptation du catalogue existant en anglais.'],
    uncertainties: ['Droits des images d’archives non vérifiés.'],
    scores: [9, 9, 6, 9, 9],
    summary: 'Narration en voix off et catalogue intemporel : excellent potentiel de doublage.',
    conclusion: 'Prospect prioritaire pour une offre catalogue.',
    excerpt: {
      title: 'La route de la soie racontée en 30 minutes',
      start: 300,
      end: 355,
      reason: 'Passage narratif emblématique du style de la chaîne.',
    },
    needs: ['Valoriser un catalogue intemporel', 'Toucher un public mondial'],
  },

  manon: {
    key: 'manon',
    creatorName: 'Manon Girard',
    channelName: 'Manon au Jardin',
    handle: 'manonaujardin-demo',
    category: 'Jardinage',
    description:
      'Potager en permaculture, calendrier des semis et astuces pour jardiner sans produits chimiques.',
    country: 'Suisse',
    subscribers: 118_000,
    views: 12_900_000,
    videos: 233,
    contactName: 'Manon Girard',
    contactEmail: 'manon@au-jardin.example',
    priority: 3,
    keywords: ['potager', 'permaculture', 'jardin naturel'],
    discoveryReason: 'Thématique saisonnière recherchée dans toute l’Europe.',
    firstObservation: 'Voix off posée et images du jardin : adaptation simple.',
    missingInfo: [],
    otherLanguages: ['Allemand (quelques mots)'],
    targetLanguages: ['Allemand', 'Anglais'],
    frequency: '1 vidéo par semaine',
    contentTypes: ['Tutoriels de jardinage', 'Calendrier des semis'],
    recentVideos: [
      {
        title: 'Préparer son potager pour l’hiver',
        daysBefore: 5,
        views: 54_000,
        durationSeconds: 840,
        contentType: 'Tutoriel',
      },
      {
        title: 'Le calendrier des semis de novembre',
        daysBefore: 12,
        views: 47_000,
        durationSeconds: 600,
        contentType: 'Calendrier',
      },
    ],
    signals: [observation('Chaîne suisse : une partie du public est germanophone.')],
    markets: [hypothesis('Allemagne et Autriche : forte culture du jardinage.')],
    adaptable: [observation('Contenus saisonniers réutilisables chaque année.')],
    trend: observation('Pics d’audience au printemps.'),
    strengths: [observation('Contenu durable et saisonnier.')],
    weaknesses: [observation('Audience très saisonnière.')],
    opportunities: [hypothesis('Version allemande prête pour le printemps.')],
    risks: [hypothesis('Le climat diffère selon les pays : certains conseils à adapter.')],
    recommendations: ['Proposer l’allemand en priorité, avant le printemps.'],
    uncertainties: [],
    scores: [7, 8, 8, 7, 7],
    summary: 'Contenu saisonnier durable avec un public germanophone naturel.',
    conclusion: 'Bon potentiel, calendrier d’approche à caler avant le printemps.',
    excerpt: {
      title: 'Préparer son potager pour l’hiver',
      start: 60,
      end: 110,
      reason: 'Conseils clairs et universels.',
    },
    needs: ['Toucher le public germanophone'],
  },

  antoine: {
    key: 'antoine',
    creatorName: 'Antoine Dubois',
    channelName: 'Finances Simples',
    handle: 'financessimples-demo',
    category: 'Finances personnelles',
    description:
      'Budget, épargne et premiers investissements expliqués simplement, sans promesse miracle.',
    country: 'France',
    subscribers: 289_000,
    views: 31_600_000,
    videos: 174,
    contactName: 'Antoine Dubois',
    contactEmail: 'antoine@finances-simples.example',
    priority: 4,
    keywords: ['budget', 'épargne', 'finances personnelles'],
    discoveryReason: 'Pédagogie claire et forte demande internationale sur l’éducation financière.',
    firstObservation: 'Tableaux à l’écran en français : à adapter en plus du doublage.',
    missingInfo: [],
    otherLanguages: [],
    targetLanguages: ['Espagnol', 'Anglais'],
    frequency: '1 vidéo par semaine',
    contentTypes: ['Explications', 'Études de cas'],
    recentVideos: [
      {
        title: 'La règle 50/30/20 expliquée simplement',
        daysBefore: 6,
        views: 120_000,
        durationSeconds: 720,
        contentType: 'Explication',
      },
      {
        title: 'Épargner 100 € par mois : cas concret',
        daysBefore: 13,
        views: 98_000,
        durationSeconds: 840,
        contentType: 'Étude de cas',
      },
    ],
    signals: [observation('Les principes de budget sont universels.')],
    markets: [hypothesis('Espagne et Amérique latine : forte demande d’éducation financière.')],
    adaptable: [
      observation('Les vidéos sur le budget ne dépendent pas de la fiscalité française.'),
    ],
    trend: observation('Croissance régulière.'),
    strengths: [observation('Ton rassurant et pédagogique.')],
    weaknesses: [observation('Une partie des vidéos dépend de la fiscalité française.')],
    opportunities: [hypothesis('Série « budget » doublée en espagnol.')],
    risks: [hypothesis('Conseils financiers soumis à des règles différentes selon les pays.')],
    recommendations: ['Ne proposer que les vidéos indépendantes de la fiscalité.'],
    uncertainties: [],
    scores: [8, 7, 8, 8, 8],
    summary: 'Pédagogie claire, une partie du catalogue est universelle.',
    conclusion: 'Bon potentiel sur une sélection de vidéos.',
    excerpt: {
      title: 'La règle 50/30/20 expliquée simplement',
      start: 45,
      end: 95,
      reason: 'Principe universel, indépendant du pays.',
    },
    needs: ['Développer une audience hispanophone'],
  },

  elodie: {
    key: 'elodie',
    creatorName: 'Élodie Chevalier',
    channelName: 'Élodie Lit',
    handle: 'elodielit-demo',
    category: 'Livres',
    description: 'Chroniques littéraires, bilans de lecture et conseils pour lire davantage.',
    country: 'France',
    subscribers: 76_000,
    views: 6_100_000,
    videos: 211,
    contactName: 'Élodie Chevalier',
    contactEmail: 'elodie@elodie-lit.example',
    priority: 2,
    keywords: ['booktube', 'chronique littéraire', 'lecture'],
    discoveryReason: 'Communauté de lecteurs très engagée.',
    firstObservation:
      'Contenus centrés sur des livres francophones : intérêt international limité.',
    missingInfo: [],
    otherLanguages: [],
    targetLanguages: ['Anglais'],
    frequency: '1 vidéo par semaine',
    contentTypes: ['Chroniques', 'Bilans de lecture'],
    recentVideos: [
      {
        title: 'Mes 10 lectures préférées de l’automne',
        daysBefore: 7,
        views: 31_000,
        durationSeconds: 1_200,
        contentType: 'Bilan',
      },
    ],
    signals: [observation('Livres présentés majoritairement francophones.')],
    markets: [hypothesis('Public anglophone limité pour des livres non traduits.')],
    adaptable: [observation('Les vidéos de conseils de lecture sont plus universelles.')],
    trend: observation('Audience stable.'),
    strengths: [observation('Communauté fidèle.')],
    weaknesses: [observation('Contenus dépendants de l’actualité littéraire francophone.')],
    opportunities: [hypothesis('Vidéos de méthode (lire plus, prendre des notes).')],
    risks: [hypothesis('Faible intérêt international.')],
    recommendations: ['Approche légère, sans insister.'],
    uncertainties: [],
    scores: [5, 6, 8, 8, 5],
    summary: 'Communauté engagée mais intérêt international limité.',
    conclusion: 'Potentiel modeste, approche à faible priorité.',
    excerpt: {
      title: 'Mes 10 lectures préférées de l’automne',
      start: 20,
      end: 70,
      reason: 'Passage représentatif.',
    },
    needs: ['Gagner en visibilité'],
  },

  karim: {
    key: 'karim',
    creatorName: 'Karim Benali',
    channelName: 'Karim Joue',
    handle: 'karimjoue-demo',
    category: 'Jeux vidéo',
    description: 'Rediffusions de parties en direct, découvertes de jeux indépendants et humour.',
    country: 'France',
    subscribers: 205_000,
    views: 27_400_000,
    videos: 980,
    contactName: 'Karim Benali',
    contactEmail: 'karim@karim-joue.example',
    priority: 2,
    keywords: ['gaming', 'jeux indépendants', 'let’s play'],
    discoveryReason: 'Grosse audience et publication quotidienne.',
    firstObservation: 'Majorité de rediffusions de directs de plusieurs heures.',
    missingInfo: [],
    otherLanguages: [],
    targetLanguages: ['Anglais'],
    frequency: '1 vidéo par jour',
    contentTypes: ['Rediffusions de directs', 'Découvertes'],
    recentVideos: [
      {
        title: 'Rediffusion : 6 heures sur le nouveau jeu de survie',
        daysBefore: 1,
        views: 35_000,
        durationSeconds: 21_600,
        contentType: 'Rediffusion',
      },
    ],
    signals: [observation('Contenus improvisés avec beaucoup d’interactions avec le chat.')],
    markets: [hypothesis('Marché anglophone du gaming très saturé.')],
    adaptable: [observation('Seules les vidéos « découverte » seraient adaptables.')],
    trend: observation('Audience stable.'),
    strengths: [fact('Publication quotidienne.')],
    weaknesses: [observation('Format long et improvisé, peu adapté au doublage.')],
    opportunities: [],
    risks: [hypothesis('Coût de doublage disproportionné pour des directs de plusieurs heures.')],
    recommendations: ['Ne pas prioriser ce prospect.'],
    uncertainties: [],
    scores: [5, 3, 10, 7, 4],
    summary: 'Grosse audience mais format (directs longs et improvisés) peu adapté au doublage.',
    conclusion: 'Faible adéquation avec notre offre.',
    excerpt: { title: '', start: 0, end: 0, reason: '' },
    needs: [],
  },

  pauline: {
    key: 'pauline',
    creatorName: 'Pauline Mercier',
    channelName: 'Pauline Code',
    handle: 'paulinecode-demo',
    category: 'Programmation',
    description:
      'Apprendre à coder pas à pas : cours de développement web pour débutants et projets concrets.',
    country: 'France',
    subscribers: 352_000,
    views: 44_800_000,
    videos: 290,
    contactName: 'Pauline Mercier',
    contactEmail: 'pauline@pauline-code.example',
    priority: 5,
    keywords: ['apprendre à coder', 'développement web', 'tutoriel JavaScript'],
    discoveryReason: 'Cours structurés et intemporels, très forte demande mondiale.',
    firstObservation: 'Écran de code commenté en voix off : doublage simple.',
    missingInfo: [],
    otherLanguages: ['Anglais (code et termes techniques)'],
    targetLanguages: ['Anglais', 'Espagnol', 'Portugais'],
    frequency: '2 vidéos par semaine',
    contentTypes: ['Cours', 'Projets guidés'],
    recentVideos: [
      {
        title: 'Créer son premier site web en 1 heure',
        daysBefore: 4,
        views: 260_000,
        durationSeconds: 3_600,
        contentType: 'Cours',
      },
      {
        title: 'JavaScript : les fonctions expliquées',
        daysBefore: 9,
        views: 180_000,
        durationSeconds: 1_500,
        contentType: 'Cours',
      },
    ],
    signals: [fact('Le code affiché est déjà en anglais.')],
    markets: [hypothesis('Marchés hispanophone et lusophone très demandeurs de cours de code.')],
    adaptable: [observation('Cours intemporels, structure en chapitres.')],
    trend: fact('Croissance de 25 % sur un an (statistiques fictives).'),
    strengths: [observation('Pédagogie très structurée.')],
    weaknesses: [observation('Vidéos longues : coût de doublage plus élevé.')],
    opportunities: [hypothesis('Parcours complet doublé en espagnol.')],
    risks: [hypothesis('Les technologies présentées évoluent vite.')],
    recommendations: ['Proposer un parcours débutant complet en espagnol.'],
    uncertainties: [],
    scores: [9, 9, 8, 8, 9],
    summary: 'Cours structurés, voix off, code déjà en anglais : profil idéal.',
    conclusion: 'Prospect prioritaire.',
    excerpt: {
      title: 'Créer son premier site web en 1 heure',
      start: 600,
      end: 655,
      reason: 'Explication claire d’une notion clé.',
    },
    needs: ['Toucher les débutants hispanophones', 'Vendre ses formations à l’international'],
  },
} satisfies Record<string, DemoProfile>;
