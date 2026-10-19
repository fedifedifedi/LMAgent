@AGENTS.md

# Projet : LMAgent
App Next.js qui génère une lettre de motivation personnalisée par offre d'emploi, avec aperçu et export PDF designé.

## Stack
Next.js 16 (App Router), TypeScript strict, Tailwind, shadcn/ui, @anthropic-ai/sdk, Zod, Prisma + SQLite, puppeteer-core (PDF).

## Environnement (important)
- PDF : puppeteer-core (PAS puppeteer, pas de Chrome téléchargé) avec Edge local, chemin dans CHROME_PATH (.env.local) :
  C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
- N'installer un paquet qu'à l'étape où il sert.
- .env.local contient la clé API : ne jamais l'écraser.

## Environnement (important)
- Windows + PowerShell.
- Installer les paquets avec Bun, PAS npm (npm échoue sur les gros téléchargements sur cette machine) :
  & "$env:USERPROFILE\.bun\bin\bun.exe" add <paquet>
- Lancer le projet avec : npm run dev

## Pipeline de l'agent (lib/agent/)
analyzeOffer → matchProfile → writeLetter → critique (puis réécriture) → rendu template.
Chaque étape = une fonction, sortie validée par un schéma Zod.

## Règles
- Ne jamais inventer une compétence ou expérience absente de data/profile.json.
- Lettre d'une page max, en FR ou EN selon la langue de l'offre.
- Les templates de lettre sont des composants React/Tailwind, utilisés à la fois pour l'aperçu et le PDF.
- Clé API dans .env.local, jamais côté client.
- Avancer étape par étape : proposer un plan avant de coder chaque fonctionnalité.
- Un commit à la fin de chaque étape validée, message clair en anglais.
