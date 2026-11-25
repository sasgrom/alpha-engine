import { describe, expect, it } from "vitest";
import { languageText, newsLanguage } from "./news-language";

const english = (title: string, summary = "", publisher = "Benzinga", url = "https://x") => newsLanguage({ title, summary, publisher, url }).english;

describe("English-only news", () => {
  it("drops releases in other languages", () => {
    expect(english("Valona lance son agent de recherche approfondie pour l'intelligence concurrentielle et de marché")).toBe(false);
    expect(english("Datos clave: Abbott inicia el ensayo Voyager; Leerink eleva su recomendación - TradingView", "", "TradingView")).toBe(false);
    expect(english("Zelluna ASA: Innkalling til ekstraordinær generalforsamling – internasjonale biofarma ledere")).toBe(false);
    expect(english("Заявление Authentix о технологии маркировки топлива в Черногории")).toBe(false);
  });

  it("keeps English, including short headlines every detector misreads", () => {
    expect(english("Expedia declares $0.48 dividend")).toBe(true);
    expect(english("SA analyst upgrades/downgrades: NVDA, CMCSA, ANET, AAPL")).toBe(true);
    expect(english("BXP - Forbes", "Forbes", "Forbes")).toBe(true);
    expect(english("Do Wall Street Analysts Like DuPont de Nemours Stock? - Yahoo Finance", "", "Yahoo Finance")).toBe(true);
    expect(english("Perusahaan Perseroan (Persero) PT Telekomunikasi Indonesia Tbk GAAP EPS of IDR 100.75")).toBe(true);
    expect(english("Expedia Group announced an agreement to acquire Kiwi.com to strengthen its flight booking capabilities")).toBe(true);
  });

  it("takes GlobeNewswire's own language code", () => {
    expect(newsLanguage({ title: "Résultats annuels", url: "https://www.globenewswire.com/news-release/2026/11/25/3410027/0/fr/x.html" })).toEqual({ english: false, language: "fr", how: "address" });
    expect(newsLanguage({ title: "Notification of Major Holdings", url: "https://www.globenewswire.com/news-release/2026/11/25/3410027/0/en/x.html" }).english).toBe(true);
  });

  it("reads only the words that carry language", () => {
    expect(languageText({ title: "Citi Cuts PT on Adobe Inc. (ADBE) - Yahoo Finance", summary: "Yahoo Finance", publisher: "Yahoo Finance" })).toBe("Citi Cuts on Adobe Inc");
  });
});
