import {
  ArrowRight,
  Check,
  House,
  LockKeyhole,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";
const PRIVATE_SITE_URL = "https://persoenliches-wetter-dashboard.eisenbahnerflo.chatgpt.site";

export default async function LoginPage() {
  const user = await getChatGPTUser();
  if (user) redirect("/");
  const hostname = (await headers()).get("host")?.split(":")[0].toLowerCase() ?? "";
  const supportsChatGPTSignIn = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".chatgpt.site");
  const signInHref = supportsChatGPTSignIn ? chatGPTSignInPath("/") : `${PRIVATE_SITE_URL}/login`;

  return (
    <main className="login-page">
      <div className="login-orbit login-orbit--one" aria-hidden="true" />
      <div className="login-orbit login-orbit--two" aria-hidden="true" />

      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="login-brand__mark" aria-hidden="true">
            <span className="login-brand__logo" aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Persönliches Dashboard</p>
            <p className="login-brand__title">Wetter</p>
          </div>
        </div>

        <div className="login-card">
          <div className="login-card__icon" aria-hidden="true">
            <LockKeyhole size={22} strokeWidth={1.8} />
          </div>
          <p className="eyebrow login-eyebrow">Privater Bereich</p>
          <h1 id="login-title">Dein Wetter, überall dabei.</h1>
          <p className="login-card__copy">
            Melde dich an, damit deine Plätze für Zu Hause und Arbeit sicher
            gespeichert und auf deinen Geräten synchronisiert werden.
          </p>

          <a className="login-button" href={signInHref}>
            {supportsChatGPTSignIn ? "Mit ChatGPT anmelden" : "Zur privaten Anmeldung"}
            <ArrowRight size={17} aria-hidden="true" />
          </a>

          <div className="login-trust" aria-label="Vorteile der Anmeldung">
            <span>
              <ShieldCheck size={15} aria-hidden="true" /> Privater Speicher
            </span>
            <span>
              <Check size={15} aria-hidden="true" /> Geräteübergreifend
            </span>
          </div>
        </div>

        <div className="login-features" aria-label="Dashboard-Funktionen">
          <div>
            <span className="login-feature__icon" aria-hidden="true">
              <House size={17} />
            </span>
            <span>
              <strong>Zu Hause &amp; Arbeit</strong>
              <small>Zwei feste Wetterplätze</small>
            </span>
          </div>
          <div>
            <span className="login-feature__icon" aria-hidden="true">
              <MapPin size={17} />
            </span>
            <span>
              <strong>Ortssuche</strong>
              <small>Deutschland, Italien, Schweiz &amp; Österreich</small>
            </span>
          </div>
        </div>

        <p className="login-footer">
          {supportsChatGPTSignIn
            ? "Die Anmeldung erfolgt über die sichere Sites-/ChatGPT-Anmeldung. Das Dashboard speichert keine Passwörter."
            : "Die geräteübergreifende Anmeldung ist auf der privaten Sites-Version verfügbar. Das Dashboard speichert keine Passwörter."}
        </p>
        <Link className="login-back-link" href="/">
          Zur Wetterübersicht
        </Link>
      </section>
    </main>
  );
}
