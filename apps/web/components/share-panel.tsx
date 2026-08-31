"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HiOutlineArrowDownTray,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineShare,
  HiOutlineXMark,
} from "react-icons/hi2";
import { SiX } from "react-icons/si";
import { useLocale, useT } from "./i18n-provider";
import { t as translate, type Locale, type Translate } from "@/lib/i18n";
import { usePreference } from "./use-preference";
import { useDismissable } from "./use-dismissable";
import { useFocusTrap } from "./use-focus-trap";
import {
  HEIGHT,
  WIDTH,
  loadIcon,
  drawCard,
  withProjectRemainder,
  type ShareProject,
} from "./share-card";

type ShareActionState = "idle" | "preparing" | "copied" | "downloaded" | "failed";

/**
 * Show your panorama without showing your record.
 *
 * The card is composed in the browser and downloaded to the disk. **Panoma does not upload it
 * anywhere**: there is no image service, no upload, no expiring link. Publishing it is a decision
 * that is made afterward, manually, wherever one wants.
 *
 * Everything that can identify you is chosen here and by default is turned off or empty: the
 * username is written if desired, and the project icons —which are the most recognizable thing
 * there is— can be removed with one click. Asking before showing is the minimum in a feature whose
 * purpose is for something to leave your machine.
 */

export interface PanoramaData {
  projects: number;
  technologies: number;
  commits: number;
  agents: number | null;
  /** The visible projects that give identity to the card, the most recent first. */
  featuredProjects: { name: string; health: number; icon: string }[];
}

export function SharePanel({
  data,
  discreet,
  onClose,
}: {
  data: PanoramaData;
  /** If the catalog is in discreet mode, the card starts just as discreet. */
  discreet: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const appLocale = useLocale();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
    Escape closed the other four panels of the application and this one did not.
    It was the only curtain that didn't close with the keyboard: you had to find the ✕ with the
    mouse. And it is precisely the panel that makes you most want to leave without touching
    anything, because inside there is a card with the name of your projects.
    The same hook as the other four is used, so it also closes when clicking outside, which is
    what the palette and the confirmation already do.
   */
  useDismissable(boxRef, true, onClose);
  useFocusTrap(boxRef, true);

  /*
    The focus goes into the ✕: it is the exit, and it is what is sought when opening something out
    of curiosity.
   */
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(cuadro);
  }, []);
  // It is remembered so as not to rewrite it every time; empty by default, which is safe.
  const [user, setUser] = usePreference("share:user", "", "compartir:usuario");
  const [shareLocale, setShareLocale] = usePreference<Locale>(
    "share:language",
    appLocale,
    "compartir:idioma",
  );
  const [withIcons, setWithIcons] = useState(!discreet);
  const [copied, setCopied] = useState(false);
  const [imageShareState, setImageShareState] = useState<ShareActionState>("idle");
  const [xShareState, setXShareState] = useState<ShareActionState>("idle");
  const shareT = useCallback<Translate>(
    (key, vars) => translate(shareLocale, key, vars),
    [shareLocale],
  );

  const paint = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const logo = await loadIcon("/assets/brand/panoma.svg");
    const loadedProjects: ShareProject[] = withIcons
      ? (
          await Promise.all(
            data.featuredProjects.slice(0, 8).map(async (project) => ({
              ...project,
              loadedIcon: await loadIcon(project.icon),
            })),
          )
        ).flatMap(({ loadedIcon, ...project }) =>
          loadedIcon ? [{ ...project, icon: loadedIcon }] : [],
        )
      : data.featuredProjects.slice(0, 8).map((project, index) => ({
          name: shareT("store.hidden", { n: index + 1 }),
          health: project.health,
          icon: null,
          concealed: true,
        }));
    const featuredProjects = withProjectRemainder(
      loadedProjects,
      data.projects,
      (omitted) => ({
        name: shareT("share.more", { n: omitted }),
        health: 0,
        icon: logo,
        panomaMark: true,
        summary: true,
      }),
    );

    drawCard(canvas, {
      ...data,
      logo,
      featuredProjects,
      user: user.trim() ? user.trim().replace(/^@?/, "@") : undefined,
      domain: DOMAIN,
      texts: {
        title: shareT("share.titulo", { n: data.projects }),
        projects: shareT("share.proyectos"),
        technologies: shareT("share.tecnologias"),
        commits: shareT("share.commits"),
        agents: shareT("share.agentes"),
        health: shareT("share.salud"),
        healthGood: shareT("share.saludBien"),
        healthReview: shareT("share.saludRevisar"),
        healthAttention: shareT("share.saludAtencion"),
        localFirst: shareT("share.local"),
      },
    });
  }, [withIcons, data, shareT, user]);

  useEffect(() => {
    void paint();
  }, [paint]);

  async function download() {
    const blob = await canvasBlob(canvasRef.current);
    if (blob) downloadBlob(blob);
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(socialText(data, shareT));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Without a clipboard, the text remains visible on the X button itself.
    }
  }

  async function shareImage() {
    setImageShareState("preparing");
    const blob = await canvasBlob(canvasRef.current);
    if (!blob) {
      setImageShareState("failed");
      return;
    }

    const text = socialText(data, shareT);
    const file = new File([blob], FILE_NAME, { type: "image/png" });

    if (canShareFiles(file)) {
      try {
        await navigator.share({ files: [file], text, title: "Panoma" });
        setImageShareState("idle");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setImageShareState("idle");
          return;
        }
      }
    }

    const copiedImage = await copyImage(blob);
    if (!copiedImage) downloadBlob(blob);
    setImageShareState(copiedImage ? "copied" : "downloaded");
    window.setTimeout(() => setImageShareState("idle"), 2600);
  }

  async function openDirectX() {
    setXShareState("preparing");
    const blob = canvasPngBlob(canvasRef.current);
    if (!blob) {
      setXShareState("failed");
      return;
    }

    /*
      The web intent of X accepts text but not files. Writing to the clipboard is initiated during
      the same gesture that opens X, so the browser retains the permission and the composer
      appears immediately. You just have to paste the PNG into the post.
     */
    const imageCopy = copyImage(blob);
    openXComposer(socialText(data, shareT));
    const copiedImage = await imageCopy;
    if (!copiedImage) downloadBlob(blob);
    setXShareState(copiedImage ? "copied" : "downloaded");
    window.setTimeout(() => setXShareState("idle"), 2600);
  }

  return (
    <div className="share" role="dialog" aria-modal="true" aria-label={t("share.abrir")}>
      <div className="share__box" ref={boxRef}>
        <header>
          <h2>{t("share.abrir")}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("share.cerrar")}>
            <HiOutlineXMark aria-hidden />
          </button>
        </header>

        {/*
           The preview is the actual canvas that is downloaded, to scale: what you see is exactly
           what comes out, without a second mock-up that could lie.
          */}
        <canvas
          ref={canvasRef}
          className="share__canvas"
          width={WIDTH}
          height={HEIGHT}
          /*
            A `<canvas>` without paper is nothing for a screen reader: neither image, nor text,
            nor a gap to announce. And this is the entire card.
           */
          role="img"
          aria-label={t("share.preview")}
        />

        <div className="share__options">
          <div className="share__language">
            <span>{t("share.idioma")}</span>
            <div role="group" aria-label={t("share.idioma")}>
              <button
                type="button"
                className={shareLocale === "es" ? "is-active" : undefined}
                aria-pressed={shareLocale === "es"}
                onClick={() => setShareLocale("es")}
              >
                Español
              </button>
              <button
                type="button"
                className={shareLocale === "en" ? "is-active" : undefined}
                aria-pressed={shareLocale === "en"}
                onClick={() => setShareLocale("en")}
              >
                English
              </button>
            </div>
          </div>
          <label>
            <span>{t("share.usuario")}</span>
            <input
              value={user}
              onChange={(event) => setUser(event.target.value)}
              placeholder={t("share.usuarioVacio")}
              spellCheck={false}
              maxLength={40}
            />
          </label>
          <button
            type="button"
            className={`share__visibility${withIcons ? "" : " is-private"}`}
            onClick={() => setWithIcons((visible) => !visible)}
            aria-pressed={!withIcons}
            aria-label={t(withIcons ? "store.hideNames" : "store.showNames")}
            title={t(withIcons ? "store.hideNames" : "store.showNames")}
          >
            {withIcons ? <HiOutlineEye aria-hidden /> : <HiOutlineEyeSlash aria-hidden />}
          </button>
        </div>

        <p className="share__note">{t("share.nota")}</p>

        <footer>
          <button type="button" className="share__primary" onClick={download}>
            <HiOutlineArrowDownTray aria-hidden />
            {t("share.descargar")}
          </button>
          <button type="button" onClick={copyText}>
            {t(copied ? "share.textoCopiado" : "share.copiarTexto")}
          </button>
          <button
            type="button"
            onClick={shareImage}
            disabled={imageShareState === "preparing"}
          >
            <HiOutlineShare aria-hidden />
            {t(`share.image.${imageShareState}`)}
          </button>
          <button
            type="button"
            onClick={openDirectX}
            disabled={xShareState === "preparing"}
          >
            <SiX aria-hidden />
            {t(`share.x.${xShareState}`)}
          </button>
        </footer>
      </div>
      <button
        type="button"
        className="share__backdrop"
        onClick={onClose}
        aria-label={t("share.cerrar")}
      />
    </div>
  );
}

/**
 * The domain that goes on the card.
 *
 * In a constant and unwritten out there loose: it is the only thing in the image that has to be
 * exact, because a card that circulates with a wrong domain sends people to nowhere.
 */
const DOMAIN = "panoma.ai";
const FILE_NAME = "panoma-projects.png";

function canvasBlob(canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  return new Promise((ready) => {
    if (!canvas) {
      ready(null);
      return;
    }
    canvas.toBlob(ready, "image/png");
  });
}

/** Synchronous version to not lose the gesture that allows copying and opening a tab. */
function canvasPngBlob(canvas: HTMLCanvasElement | null): Blob | null {
  if (!canvas) return null;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: "image/png" });
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

function canShareFiles(file: File): boolean {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

async function copyImage(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || typeof navigator.clipboard?.write !== "function") {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function openXComposer(text: string): void {
  const link = document.createElement("a");
  link.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.click();
}

/**
 * The text that accompanies the image. It is composed by the dictionary, which knows what language
 * you are in.
 */
function socialText(data: PanoramaData, t: Translate): string {
  return t("share.texto", { n: data.projects, domain: DOMAIN });
}
