// Balaji Palani — Senior Scrum Master & Agile Delivery Lead Portfolio Village
// 100% Zero-cost Three.js 3D Village Portfolio Engine

export const CONTENT = {
  identity: {
    name: "Balaji Palani",
    displayName: "BALAJI PALANI",
    role: "Senior Scrum Master · Agile Delivery Lead",
    tagline: "7+ Years IT & 4+ Years Dedicated Scrum Master Leadership. CSM® & SAFe® 6.0 certified. 0-Day Notice (Immediate Joiner).",
    location: "Mumbai, India (Open to Remote / Pan-India)",
    targetRoles: ["Senior Scrum Master", "Scrum Master", "Agile Delivery Lead", "Agile Coach"],
    availability: "0-Day Notice (Immediate Joiner)",
    startedCoding: "2019",
    email: "balajinia@gmail.com",
    phone: "+91-7540015522",
    resumeUrl: "#",
    github: "https://github.com/layyzee",
    linkedin: "https://linkedin.com/in/balajipalani",
    whatsapp: "https://wa.me/917540015522?text=Hi%20Balaji,%20reviewed%20your%203D%20Clash%20Village%20portfolio%20and%20would%20love%20to%20connect!",
  },

  stats: {
    experience: "7+ Years",
    scrumLeadership: "4+ Years",
    velocityBoost: "+20%",
    blockerReduction: "40%",
    artSquads: "10 Teams",
    projects: 11,
    repos: 12,
    stack: 18,
    stars: 24,
    achievements: "6/6",
  },

  about: {
    intro:
      "Hi, I’m Balaji Palani. I’m a Senior Scrum Master and Agile Delivery Lead based in Mumbai with 7+ years of total software engineering and Agile leadership experience.",
    paragraphs: [
      "My journey spans both technical engineering and high-impact servant leadership. I started hands-on with React, React Native, Node.js, and AWS, and evolved into dedicated Agile leadership managing high-performing engineering squads across Tier-1 financial banking and enterprise telecom systems.",
      "At MITS Global Consulting, I led 3 concurrent cross-functional Scrum teams on a major UK BFSI banking initiative. By instituting automated Jira Definition of Ready (DoR) and Done (DoD), we eliminated 40% of mid-sprint blocker tickets, reduced sprint planning overhead by 30%, and boosted team velocity by 20% in just 4 sprints.",
      "At Incedo Inc., I facilitated 2 enterprise Program Increment (PI) planning cycles across an Agile Release Train (ART) of 10 distributed squads and 120+ software engineers for Verizon, achieving a 92% predictability delivery rate on committed objectives under SAFe 6.0.",
      "I am also an active vibe coder who understands modern tech deeply. I build full-stack, zero-cost production tools like SlotCraft (a private clinic queue SaaS with 80mm POS slip printing), Sri Sai Satcharitra (a desktop reader with Web Audio synthesized Tanpura drone), and Career-Ops (an autonomous daily portal scanning engine).",
      "I hold both CSM® (Scrum Alliance) and SAFe® 6.0 Scrum Master certifications, and I am on a strict 0-day notice period — available for immediate interview and joining.",
    ],
  },

  funFacts: [
    "Enforced automated Jira DoR/DoD cutting mid-sprint blockers by 40% on UK BFSI banking.",
    "Facilitated 2 enterprise PI planning cycles across 10 teams and 120+ engineers for Verizon.",
    "SlotCraft runs 6 clinical portals on a zero-cloud-cost local SQLite engine without monthly bills.",
    "Sai Satcharitra synthesizes pure Indian classical Tanpura frequencies using Web Audio oscillators in real time.",
    "Career-Ops scans 187+ enterprise portals daily at 10:30 AM with Mac desktop banner alerts.",
    "Dual certified: Certified ScrumMaster (CSM®) and SAFe® 6.0 Scrum Master (SSM).",
    "Boosted team sprint velocity by 20% in 4 sprints through continuous retro coaching.",
    "0-day notice period: Available for immediate deployment across Mumbai, Bengaluru, Pune, or Remote.",
  ],

  projects: [
    {
      id: "recoup",
      title: "SlotCraft Clinic SaaS",
      year: "2026",
      role: "Solo build · Health SaaS",
      level: 5,
      inProgress: false,
      summary:
        "Private clinic smart queue & appointment SaaS built for doctors in Dombivli & MMR. 100% Zero-cost Next.js App Router + SQLite.",
      pitch:
        "Private clinic queue and appointment management SaaS built for private clinics in Dombivli & MMR. Built 6 integrated portals: Doctor Consultation Desk with instant Rx prescriptions, Receptionist caller with WhatsApp patient delay alerts, 80mm thermal POS paper receipt slip generator, and full-screen 55-inch waiting room TV display with automated voice chimes. Powered by a self-contained local SQLite database with zero cloud bills.",
      stack: ["Next.js App Router", "Node.js", "SQLite", "ESC/POS", "WhatsApp API", "Tailwind CSS"],
      result: "6 live portals · 80mm POS slip · ₹0 cloud cost",
      details:
        "Doctor Room Consultation Desk with Rx presets and printable letterhead, self-service patient delay buffer, 80mm thermal POS slips with QR tracking, and daily accounting CSV exports.",
      links: [
        { label: "GitHub", url: "https://github.com/layyzee/slotcraft" },
      ],
      featured: true,
    },
    {
      id: "clockwork",
      title: "UK BFSI Banking Programme",
      year: "2024 — 2026",
      role: "Scrum Master · MITS Global",
      level: 6,
      inProgress: false,
      summary:
        "Managed 3 concurrent Scrum squads for a Tier-1 UK financial banking platform across London and India timezones.",
      pitch:
        "Managed 3 concurrent cross-functional engineering squads for Tier-1 UK financial banking systems. Instituted automated Jira Definition of Ready (DoR) and Done (DoD), which cut mid-sprint blocker occurrences by 40% and reduced sprint planning overhead by 30%. Boosted team velocity by 20% in 4 sprints through continuous retrospective coaching and flow metrics.",
      stack: ["Jira Software", "Confluence", "AWS", "CI/CD", "Scrum Leadership", "Kanban Flow"],
      result: "+20% velocity · -40% blockers · -30% planning time",
      details:
        "Bridged product owners in London with engineering squads in India, resolved cross-team architecture impediments, and turned unpredictable sprints into reliable bi-weekly releases.",
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: true,
    },
    {
      id: "starthunt",
      title: "Career-Ops Engine",
      year: "2026",
      role: "Solo build · Automation",
      level: 5,
      inProgress: false,
      summary:
        "Autonomous job search engine that scans 187+ enterprise portals daily at 10:30 AM with Mac notifications.",
      pitch:
        "Autonomous daily daemon scanning 187+ enterprise career portals every morning at 10:30 AM. Enforces a strict 30-day company cooldown blacklist so repeat applications never occur. Calculates ATS capability match scores (>= 4.0 target), generates customized Markdown audit reports and production PDFs, and serves a live local web dashboard at http://127.0.0.1:3000.",
      stack: ["Python", "Shell Scripts", "Launchd Daemon", "macOS Notifications", "Next.js Dashboard"],
      result: "187+ portals scanned · 0 duplicate applications",
      details:
        "Autonomous daily background scanning at 10:30 AM, customized ATS resume generator, Mac chime notifications, and local management console.",
      links: [
        { label: "GitHub", url: "https://github.com/layyzee" },
      ],
      featured: true,
    },
    {
      id: "sandbox-code-agent",
      title: "Verizon Enterprise ART",
      year: "2022 — 2024",
      role: "Scaled Agile · Incedo Inc.",
      level: 6,
      inProgress: false,
      summary:
        "Facilitated 2 enterprise PI Planning cycles across a 10-team Agile Release Train with 120+ software engineers.",
      pitch:
        "Facilitated 2 enterprise Program Increment (PI) planning cycles across 10 distributed squads and 120+ software engineers for Verizon. Established live cross-squad architecture dependency mapping, resolving inter-team bottlenecks during the 2-day event. Guided squads to deliver 92% of committed PI objectives under SAFe 6.0 principles.",
      stack: ["SAFe 6.0", "Enterprise PI Planning", "Jira Align", "Confluence", "Cross-Team Mapping"],
      result: "10 squads aligned · 92% committed objectives delivered",
      details:
        "Conducted system demos, facilitated scrum of scrums, managed program risks on the ROAM board, and ensured seamless multi-squad feature delivery.",
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: true,
    },
    {
      id: "litmus",
      title: "Sai Satcharitra Desktop App",
      year: "2026",
      role: "Solo build · Desktop Suite",
      level: 5,
      inProgress: false,
      summary:
        "Cross-platform desktop meditation reader with real-time synthesized Tanpura drone frequencies (Key 'M').",
      pitch:
        "Cross-platform desktop meditation reader packaged as a macOS DMG and Windows release. Integrated a zero-asset Web Audio API Tanpura drone synthesizer generating authentic Indian classical resonance (Key 'M') with zero audio files. Features persistent reading bookmarks, search, and daily quote notifications.",
      stack: ["JavaScript", "Web Audio API", "Electron", "macOS (.dmg)", "CSS"],
      result: "Production v1.2.0 shipped on GitHub Releases",
      details:
        "Synthesizes authentic Indian classical acoustic drone harmonics via Web Audio oscillators, bookmark reading resumes, and accessible dark/light reading modes.",
      links: [
        { label: "GitHub Releases (DMG)", url: "https://github.com/layyzee/sai-satcharitra-reader/releases/tag/v1.2.0" },
        { label: "Source Code", url: "https://github.com/layyzee/sai-satcharitra-reader" },
      ],
      featured: true,
    },
    {
      id: "verdict",
      title: "Jira Automated DoR/DoD",
      year: "2023 — 2026",
      role: "Agile Process Engineering",
      level: 5,
      inProgress: false,
      summary:
        "Automated Definition of Ready & Done governance system that eliminated 40% of mid-sprint scope creep.",
      pitch:
        "Automated Jira workflow governance protocol enforcing acceptance criteria and tech-ready checklists before tickets enter the sprint backlog. Slashed sprint planning meetings from 4 hours down to 2.5 hours and eliminated 40% of scope-creep blockers during active sprints.",
      stack: ["Jira Automation", "Confluence API", "Flow Metrics", "Continuous Delivery"],
      result: "-30% planning overhead · 40% blocker reduction",
      details:
        "Automated ticket status transitions, mandatory acceptance criteria gates, and live burndown telemetry dashboards.",
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: false,
    },
    {
      id: "bug-gym",
      title: "CDP360 EdTech Platform",
      year: "2021 — 2022",
      role: "Agile Lead · Web & Mobile",
      level: 5,
      inProgress: false,
      summary:
        "Guided engineering squads for international mobile and web releases on tight deadlines.",
      pitch:
        "Led sprint planning, daily standups, and retrospectives for multi-platform web and mobile releases. Maintained 100% on-time app store deployments without rollbacks while coaching developers on clean coding practices.",
      stack: ["React Native", "React.js", "Node.js", "Agile Sprints"],
      result: "On-time store deployments · 0 critical rollbacks",
      details:
        "Fast-paced startup agility, continuous delivery pipelines, and sprint velocity monitoring.",
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: false,
    },
    {
      id: "workflow-to-agent",
      title: "Sprint Velocity Optimizer",
      year: "2024 — 2026",
      role: "Agile Coaching · Continuous Flow",
      level: 5,
      inProgress: false,
      summary:
        "Continuous improvement retrospective loop that lifted team velocity by 20% in 4 consecutive sprints.",
      pitch:
        "Engineered sprint retrospective feedback loops turning qualitative developer pain points into concrete, actionable backlog improvements. Eliminated meeting fatigue and boosted team velocity by 20% within 4 sprints.",
      stack: ["Retrospective Frameworks", "Cycle Time Analytics", "Psychological Safety", "Kanban"],
      result: "+20% sprint velocity surge",
      details:
        "Replaced mundane status checks with crisp Jira dashboards and fostered high psychological safety across London and India squads.",
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: false,
    },
    {
      id: "isotherm",
      title: "5-Whys Blocker Neutralizer",
      year: "2022 — 2026",
      role: "Tactical Impediment Removal",
      level: 5,
      inProgress: false,
      summary:
        "Standardized root cause analysis protocol that resolved over 450+ engineering blockers within 4 hours.",
      pitch:
        "Standardized root cause impediment removal battery. Whenever an external API, database, or infrastructure blocker arose, coordinated rapid 5-Whys analysis and swarming to clear blockers within 4 hours.",
      stack: ["5-Whys Root Cause Analysis", "Dependency Escalation", "Cross-Squad Swarming"],
      result: "450+ blockers neutralized",
      details:
        "Protected developer flow state and prevented external dependencies from stalling sprint deliveries.",
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: false,
    },
    {
      id: "vibely",
      title: "Certified ScrumMaster (CSM®)",
      year: "Scrum Alliance",
      role: "Credentialed Leadership",
      level: 7,
      inProgress: false,
      summary:
        "Official Certified ScrumMaster credential issued by Scrum Alliance.",
      pitch:
        "Certified ScrumMaster (CSM®) certified by Scrum Alliance. Grounded in servant leadership, empirical process control, high-trust team facilitation, and continuous sprint delivery.",
      stack: ["Scrum Alliance", "Servant Leadership", "Backlog Refinement", "Sprint Facilitation"],
      result: "Verified CSM® Credential",
      details:
        "Mastery of Scrum ceremonies, team coaching, impediment resolution, and stakeholder value alignment.",
      links: [
        { label: "LinkedIn Profile", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: true,
    },
    {
      id: "speakwell",
      title: "SAFe® 6.0 Scrum Master (SSM)",
      year: "Scaled Agile Inc.",
      role: "Scaled Enterprise Credential",
      level: 7,
      inProgress: false,
      summary:
        "Official SAFe® 6.0 Scrum Master credential for enterprise Agile Release Trains.",
      pitch:
        "SAFe® 6.0 Scrum Master certified by Scaled Agile Inc. Proven enterprise mastery in facilitating PI planning, cross-squad ART coordination, and resolving multi-team dependencies.",
      stack: ["Scaled Agile Inc", "SAFe 6.0", "PI Planning", "ART Facilitation"],
      result: "Verified SAFe® 6.0 SSM Credential",
      details:
        "Trained in enterprise lean-agile mindset, value stream mapping, and scaling agile across hundreds of engineers.",
      links: [
        { label: "LinkedIn Profile", url: "https://linkedin.com/in/balajipalani" },
      ],
      featured: true,
    },
  ],

  skills: [
    {
      group: "Agile & Leadership",
      items: [
        { name: "Scrum & Kanban", level: "core" },
        { name: "SAFe® 6.0 & PI Planning", level: "core" },
        { name: "Servant Leadership", level: "core" },
        { name: "Jira & Confluence Automation", level: "core" },
        { name: "Sprint Ceremonies & Retros", level: "core" },
        { name: "Dependency & Risk ROAM", level: "core" },
      ],
    },
    {
      group: "Engineering & Tech",
      items: [
        { name: "React · React Native", level: "core" },
        { name: "Next.js App Router", level: "core" },
        { name: "Node.js & Express", level: "working" },
        { name: "SQLite & SQL", level: "working" },
        { name: "AWS Cloud & CI/CD", level: "working" },
        { name: "Web Audio API", level: "working" },
      ],
    },
    {
      group: "Methodologies & Tools",
      items: [
        { name: "Definition of Ready / Done", level: "core" },
        { name: "5-Whys Root Cause Analysis", level: "core" },
        { name: "Burndown & Velocity Metrics", level: "core" },
        { name: "Cross-Team Swarming", level: "core" },
      ],
    },
  ],

  clans: [
    {
      id: "mits",
      company: "MITS Global Consulting",
      suffix: "UK BFSI Programme",
      crest: "MG",
      tone: "gold",
      tenure: "2 Years",
      role: "Scrum Master",
      period: "2024 — Present",
      bullets: [
        "Managed 3 concurrent Scrum squads across London and India timezones on tier-1 banking systems.",
        "Boosted team sprint velocity by 20% in 4 sprints and cut mid-sprint blocker occurrences by 40%.",
        "Enforced automated Jira Definition of Ready (DoR) and Done (DoD), slashing sprint planning overhead by 30%.",
      ],
      tags: ["Scrum Master", "UK Banking", "Velocity +20%"],
      links: [{ label: "LinkedIn", href: "https://linkedin.com/in/balajipalani" }],
    },
    {
      id: "incedo",
      company: "Incedo Inc.",
      suffix: "Verizon ART Programme",
      crest: "II",
      tone: "red",
      tenure: "2 Years",
      role: "Scrum Master / Scaled Agile",
      period: "2022 — 2024",
      bullets: [
        "Facilitated 2 enterprise PI Planning cycles across a 10-team Agile Release Train (ART) of 120+ engineers for Verizon.",
        "Established cross-squad architecture dependency mapping, ensuring 92% committed objectives were delivered.",
      ],
      tags: ["SAFe 6.0", "PI Planning", "10-Team ART"],
      links: [{ label: "LinkedIn", href: "https://linkedin.com/in/balajipalani" }],
    },
    {
      id: "cdp360",
      company: "CDP360 Technologies",
      suffix: "EdTech & Mobile",
      crest: "CD",
      tone: "blue",
      tenure: "2 Years",
      role: "Agile Squad Lead · Full-Stack",
      period: "2020 — 2022",
      bullets: [
        "Guided cross-functional squads for international mobile and web releases on tight deadlines.",
        "Maintained 100% on-time store releases with zero critical rollbacks.",
      ],
      tags: ["React Native", "Agile Sprints", "Mobile & Web"],
      links: [{ label: "LinkedIn", href: "https://linkedin.com/in/balajipalani" }],
    },
  ],

  targetClans: [
    {
      id: "barclays",
      name: "Enterprise Agile Roles",
      crest: "AG",
      tone: "gold",
      role: "Senior Scrum Master / Delivery Lead",
      summary: "Open for Tier-1 Banks, Enterprises & High-Growth Tech Companies across Mumbai, Bengaluru, Pune, Hyderabad or Remote.",
      tags: ["Immediate Joiner", "₹22L-₹30L INR", "0-Day Notice"],
    },
  ],
};
