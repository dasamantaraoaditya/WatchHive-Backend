# MindLens 2.0: Scientifically Grounded Behavioral Architecture & Taste Intelligence

## 1. Executive Summary & Purpose

**MindLens** is WatchHive's cinematic intelligence engine. Its purpose is not to project arbitrary horoscopic archetypes, but to act as a **rigorous behavioral mirror** of a user's media consumption habits, affective mood regulation, and social influence network.

Furthermore, MindLens serves as the **diagnostic engine** for WatchHive's recommendation pipeline—identifying cognitive fatigue, taste blindspots, and validated tastemakers to surface impactful, diverse movie suggestions.

---

## 2. Theoretical & Academic Foundations

MindLens is grounded in four validated frameworks from behavioral psychology, media studies, and information theory:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             MINDLENS FOUNDATION                                  │
├─────────────────────────┬─────────────────────────────┬──────────────────────────┤
│ Academic Framework      │ Lead Authors & Literature   │ Applied Function         │
├─────────────────────────┼─────────────────────────────┼──────────────────────────┤
│ 1. Information Entropy  │ Claude Shannon (1948)       │ Taste Breadth & Genre    │
│                         │ Anderson et al. (WWW '20)   │ Dispersion (Spotify Met) │
├─────────────────────────┼─────────────────────────────┼──────────────────────────┤
│ 2. Mood Management      │ Dolf Zillmann (1988)        │ Affective Regulation &   │
│    Theory (MMT)         │ Oliver & Raney (2011)       │ Hedonic vs Eudaimonic    │
├─────────────────────────┼─────────────────────────────┼──────────────────────────┤
│ 3. Circumplex Model     │ James Russell (1980)        │ Valence & Arousal Mapping│
│    of Affect            │                             │ of Recent Watch Patterns │
├─────────────────────────┼─────────────────────────────┼──────────────────────────┤
│ 4. Recommender Trust &  │ Jennifer Golbeck (2005)     │ Bayesian Social Influence│
│    Homophily Principle  │ McPherson et al. (2001)     │ & Taste Concordance      │
└─────────────────────────┴─────────────────────────────┴──────────────────────────┘
```

---

## 3. Mathematical Formulas & Telemetry Metrics

### 3.1 Taste Diversity via Shannon Information Entropy ($H$)

To determine whether a user is a **Genre Specialist** (concentrated comfort zone) or an **Eclectic Polymath** (high appetite for novelty), we calculate the Shannon Entropy across all logged genres:

$$H(G) = -\sum_{i=1}^{K} p(g_i) \log_2 p(g_i)$$

Where:
- $K$ is the total count of distinct genres in the user's catalog.
- $p(g_i)$ is the weighted probability of genre $g_i$ (calculated using TMDB Tag Disambiguation: Primary tag weight = $1.0$, Secondary tag weight = $0.3$).

#### Normalized Taste Breadth ($B \in [0, 1]$):
$$B = \frac{H(G)}{\log_2 K}$$

| Score Range | Classification | Behavioral Interpretation |
| :--- | :--- | :--- |
| $B < 0.40$ | **Genre Specialist** | Deep, focused loyalty to 1–2 specific genres. High resistance to unfamiliar tones. |
| $0.40 \le B < 0.75$ | **Balanced Explorer** | Healthy balance of core favorite genres supplemented by occasional exploratory branches. |
| $B \ge 0.75$ | **Eclectic Polymath** | High cognitive openness; actively consumes across disparate genres and styles. |

---

### 3.2 Affective Mood State & Valence-Arousal Mapping (MMT)

Based on Zillmann's Mood Management Theory (1988) and Russell's Circumplex Model (1980), we classify recent watches (last $N=7$ entries) along two psychological axes:

1. **Valence ($V \in [-1, 1]$):** Emotional pleasantness (Joy/Comfort vs. Melancholy/Existential Grief).
2. **Arousal ($A \in [-1, 1]$):** Physiological activation (Calm/Reflective vs. Adrenaline/Tension).

#### Exponential Recency Decay Weighting:
More recent entries have higher predictive power over the user's current affective state:
$$w_k = e^{-\lambda \cdot k}, \quad k \in \{0, 1, \dots, N-1\}, \quad \lambda = 0.20$$

#### Genre Affect Coordinates Matrix:
```
           High Arousal (+A)
                  │
      Tense /     │    Excited /
   Thrill-Seeking │   Dopamine Rush
  (Horror/Crime)  │  (Action/Sci-Fi)
                  │
Negative ─────────┼───────── Positive
Valence (-V)      │       Valence (+V)
                  │
   Contemplative/ │   Comfort /
     Melancholic  │  Recharging
  (Drama/History) │ (Comedy/Family)
                  │
           Low Arousal (-A)
```

- **Top-Right (High Arousal, High Valence):** *Excited & Energized* (Action, Adventure, Sci-Fi, Superheroes).
- **Top-Left (High Arousal, Low Valence):** *High-Alert Thrill Seeking* (Horror, Psychological Thriller, Crime).
- **Bottom-Right (Low Arousal, High Valence):** *Comfort & Emotional Recharging* (Comedy, Animation, Wholesome Family, Romance).
- **Bottom-Left (Low Arousal, Low Valence):** *Eudaimonic Reflection* (Documentaries, Historical Dramas, Tragedy, Arthouse).

---

### 3.3 Recommender Trust Score ($RTS$) with Empirical Bayesian Smoothing

Friend recommendations often suffer from **Small Sample Bias** (e.g., a friend suggests 1 movie, the user rates it 10/10, making the friend appear to have 100% accuracy).

To solve this, we compute a **Bayesian-Smoothed Rating** $S_j$ that pulls low-sample friends toward the user's global average rating $M$:

$$S_j = \frac{N_j \cdot \mu_j + C \cdot M}{N_j + C}$$

Where:
- $N_j$ = Number of suggestions from friend $j$ that the user actually watched.
- $\mu_j$ = User's average rating for friend $j$'s suggestions.
- $M$ = User's overall average rating across all movies logged (e.g., 7.2).
- $C$ = Prior confidence weight ($C = 3$).

#### Conversion Rate ($CR_j$):
$$CR_j = \frac{\text{Suggestions Watched}_j}{\max(\text{Suggestions Received}_j, \text{Suggestions Watched}_j)}$$

#### Recommender Trust Score ($RTS_j \in [0, 100]$):
$$RTS_j = \left( 0.40 \cdot CR_j + 0.60 \cdot \frac{S_j}{10} \right) \cdot \min\left(1.0, \frac{N_j}{2}\right) \times 100$$

#### Recommender Badges & Roles:
- **🏆 Golden Compass ($RTS \ge 75$, $N \ge 3$):** Consistently high conversion and high rating lift.
- **🎯 Precision Tastemaker ($S_j > M + 0.8$, $N \ge 2$):** Movies recommended score significantly higher than the user's personal baseline.
- **🚀 Horizon Expander:** Recommends titles in genres with low prior user frequency that the user rated $\ge 8.0$.
- **🤝 Faithful Pitcher ($CR_j \ge 60\%$):** High conversion and alignment on general watchlist builds.

---

### 3.4 Evidence-Based Cognitive Archetypes

Replacing comic/fictional tropes (e.g. "Batman", "Contract Killer") with 6 cognitive viewing styles derived from media consumption psychology:

| Archetype | Primary Cognitive Motivation | Mathematical Trigger |
| :--- | :--- | :--- |
| **The Contemplative Eudaimonist** | Seeks emotional meaning, moral reflection, and empathetic catharsis | Drama/Doc/History $> 40\%$, avg review length $> 60$ chars |
| **The Adrenaline Synthesizer** | Seeks dopamine activation, pacing, and physiological tension | Thriller/Action/Crime $> 45\%$, low rewatch ratio ($<10\%$) |
| **The Comfort Restorer** | Seeks psychological grounding, anxiety reduction, and familiar warmth | Rewatch ratio $\ge 20\%$, Comedy/Animation/Family $> 35\%$ |
| **The Analytic Purist** | High critical discernment, technical appraisal, and aesthetic rigor | Rating variance $\sigma > 1.8$, mean rating $\le 6.5$, reviews on $\ge 30\%$ of logs |
| **The Eclectic Polymath** | Omnivorous curiosity, broad genre boundary-crossing, and novelty | Normalized Entropy $B \ge 0.75$, watches across $\ge 6$ genres |
| **The Social Connector** | Cinema as a shared emotional currency and relational bridge | Suggestion conversion $\ge 50\%$, $\ge 25\%$ of logs suggested by friends |

---

## 4. Shortcomings & Algorithmic Safeguards

| Failure Mode | Real-World Risk | MindLens Mathematical Safeguard |
| :--- | :--- | :--- |
| **The Hate-Watch Fallacy** | User logs bad horror movies (rated 2/10) $\rightarrow$ system claims user loves horror. | **Rating Threshold Gate:** Only entries rated $\ge 6.0$ (or unrated) count toward positive taste affinity and archetypes. Low-rated entries are surfaced as *"Critical Divergences"*. |
| **Small Sample Distortion** | 1 suggestion rated 10/10 ranks friend above someone with 15 solid recommendations. | **Empirical Bayesian Smoothing:** Priors ($C=3$, global mean $M$) dampen small sample sizes until sustained evidence exists. |
| **TMDB Tag Pollution** | Single movie with 5 generic tags dilutes distinct genre markers. | **Position-Weighted Tagging:** Primary genre = $1.0$, Secondary genres = $0.3$. |
| **Circadian Latency Bias** | User watches film at 7 PM but logs it at 2 AM $\rightarrow$ misdiagnosed as late-night viewer. | **Session Clustering:** Analyze watch gaps rather than single isolated log timestamps. |
| **Epistemic Arrogance** | System asserts *"You are stressed"*, alienating the user if incorrect. | **Observational Framing:** Use descriptive language (*"Your last 4 watches lean toward contemplative dramas"*) rather than psychoanalytic diagnosis. |
| **Cold Start Brittleness** | Statistical variance calculated on 3 items produces meaningless noise. | **Progressive Milestone Gates** (detailed below). |

---

## 5. Progressive Milestone Gates (Cold-Start Roadmap)

MindLens unlocks analytical depth as data accumulates, ensuring it never computes statistics on insufficient sample sizes:

```
[0 to 4 Logs]   ──► Calibration Stage: Taste map calibrating (shows progress meter: X/5)
[5 to 14 Logs]  ──► Foundational Stage: Taste Breadth (Entropy), Recent Mood Arc, Recommender Velocity
[15+ Logs]      ──► Full Cognitive Stage: Cognitive Archetype, Deep Circadian Analysis, Critical Rigor Variance
```

---

## 6. API Contract (`GET /api/v1/mindlens/insights`)

```json
{
  "hasEnoughData": true,
  "milestoneStage": "FULL", // "CALIBRATING" (0-4), "FOUNDATIONAL" (5-14), "FULL" (15+)
  "userProfile": {
    "totalEntries": 42,
    "tasteBreadth": {
      "score": 0.78,
      "label": "Eclectic Polymath",
      "entropy": 3.12,
      "description": "High cognitive openness across 8 distinct genres."
    },
    "criticalRigor": {
      "averageRating": 7.3,
      "ratingVariance": 1.4,
      "label": "Balanced Critic",
      "reviewRatio": 28
    }
  },
  "archetype": {
    "name": "The Contemplative Eudaimonist",
    "tagline": "Seeking Depth & Meaningful Reflection",
    "description": "You gravitate toward character-driven narratives that explore moral complexity and human resilience.",
    "icon": "psychology",
    "color": "#8b5cf6"
  },
  "affectiveState": {
    "state": "Emotional Exploration",
    "quadrant": "Eudaimonic Reflection",
    "valence": -0.2,
    "arousal": -0.4,
    "icon": "🌊",
    "confidence": 88,
    "recentTitles": ["Oppenheimer", "Past Lives", "Monster"]
  },
  "recommenderNetwork": {
    "summary": {
      "totalReceived": 14,
      "totalWatched": 9,
      "conversionRate": 64,
      "topInfluencerName": "Aditya",
      "topInfluencerUsername": "aditya"
    },
    "tastemakers": [
      {
        "userId": "uuid",
        "username": "aditya",
        "displayName": "Aditya",
        "profilePictureUrl": "https://...",
        "totalSuggested": 6,
        "watchedCount": 5,
        "conversionRate": 83,
        "smoothedRating": 8.4,
        "trustScore": 86,
        "badge": "🏆 Golden Compass",
        "primaryStrength": "Sci-Fi & Thrillers"
      }
    ]
  },
  "genreEntropyDistribution": [
    { "genre": "Drama", "percentage": 32, "weight": 14.5 },
    { "genre": "Sci-Fi", "percentage": 22, "weight": 10.2 }
  ],
  "insights": [
    "Your catalog displays high taste diversity (78% Taste Breadth), showing a strong appetite for novelty.",
    "**@aditya** is your Golden Compass with an 83% conversion rate and 8.4 average rating.",
    "Recent viewing has shifted toward contemplative, low-arousal dramas for evening reflection."
  ]
}
```

---

## 7. Direct Bridge to Impactful Discovery

The metrics computed here directly drive the upcoming **Diverse & Impactful Suggestions Feature**:
1. **Entropy Deficit Targeting:** Suggests high-quality titles from the user's *under-explored* genres to prevent algorithmic echo chambers.
2. **Current Affect Matching:** If the user's current affective state is *Comfort & Recharging*, prioritize upbeat, high-valence titles. If *Eudaimonic*, prioritize rich award-winning dramas.
3. **Peer-Powered Weighting:** Upweight suggestions when they align with a friend verified as a **Golden Compass** in that specific genre.
