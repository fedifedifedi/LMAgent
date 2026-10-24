/**
 * Nettoyage des textes rédigés par l'agent avant enregistrement. Au test réel, l'objet du PDF affichait
 * « Candidatureau stage » et « Nexora Labs(février 2027) » : caractères invisibles ou retours à la ligne au lieu
 * d'espaces, parenthèse collée au mot précédent.
 */
export function normalizeLetterText(text: string): string {
  return text
    .replace(/[​-‍⁠﻿]/g, " ") // espaces de largeur nulle : invisibles, ils collent les mots
    .replace(/[\r\n\t     ]+/g, " ")
    .replace(/([\p{L}\p{N}])\(/gu, "$1 (") // « Labs(février » → « Labs (février »
    .replace(/ {2,}/g, " ")
    .trim();
}

const REMOTE_DETAIL = /hybride|t[ée]l[ée]travail|remote|hybrid|pr[ée]sentiel|on-?site|distanciel|\bjours?\b|\bdays?\b|\/\s*sem/i;

/**
 * Lieu de l'entreprise pour l'en-tête de la lettre : la ville (et le pays), sans les détails du mode de travail.
 * « Lyon, France (hybride : 2 jours de télétravail) » → « Lyon, France » ; « Lyon — hybride » → « Lyon ».
 */
export function companyLocation(location: string): string {
  const head = location.split(/\s*[([{–—;|]\s*|\s+-\s+|\s*:\s+/)[0] ?? location;
  return head
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !REMOTE_DETAIL.test(part))
    .join(", ");
}
