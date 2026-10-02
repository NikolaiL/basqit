"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { blo } from "blo";
import { QRCodeSVG } from "qrcode.react";
import type { Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import { sdk, useMiniapp } from "~~/components/MiniappProvider";
import { useWalletSession } from "~~/components/WalletAuthentication";
import { BasketGrid } from "~~/components/baskets/BasketGrid";
import { useBasketRows } from "~~/components/baskets/useBasketRows";
import { totalValue } from "~~/services/baskets/value";
import { robinhoodTestnet } from "~~/services/packs/testnet";
import {
  EMPTY_PROFILE,
  LIMITS,
  type Profile,
  cleanDescription,
  cleanProfile,
  descriptionMessage,
  profileMessage,
  socialUrl,
} from "~~/services/profiles/profile";
import type { Platform, Social } from "~~/services/profiles/social";
import { notification } from "~~/utils/scaffold-eth";

type Creator = {
  profile: Profile | null;
  socials: Social[];
  baskets: { address: Address; name: string; symbol: string }[];
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function useCreator(address?: string) {
  return useQuery({
    queryKey: ["creator", address?.toLowerCase()],
    enabled: !!address,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/creators/${address}`);
      if (!response.ok) throw new Error("Could not load this creator");
      return (await response.json()) as Creator;
    },
  });
}

const put = (url: string, body: unknown) => send("PUT", url, body);
const post = (url: string, body: unknown) => send("POST", url, body);
async function send(method: string, url: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not save.");
  return json;
}

/** Crops to a centered square and shrinks to 256px, so the picture fits in the profile row. */
async function shrinkImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const quality of [0.85, 0.6, 0.4]) {
    const url = canvas.toDataURL("image/webp", quality);
    if (url.length <= LIMITS.avatar) return url;
  }
  throw new Error("This picture is too detailed. Try another one.");
}

function Avatar({ address, profile, size }: { address: Address; profile?: Profile | null; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="bq-creator-avatar"
      src={profile?.avatar || blo(address as `0x${string}`)}
      alt=""
      width={size}
      height={size}
    />
  );
}

/** "Created by" with the creator's picture and name, linking to their profile. */
export function CreatorLink({ address }: { address: Address }) {
  const profile = useCreator(address).data?.profile;
  return (
    <Link href={`/creators/${address}`} className="bq-creator-link">
      <Avatar address={address} profile={profile} size={18} />
      {profile?.name || short(address)}
    </Link>
  );
}

const NAMES: Record<Platform, string> = { x: "X", farcaster: "Farcaster" };
const socialLabel = (s: Social) => `${NAMES[s.platform]} ${s.username ? `@${s.username}` : `FID ${s.accountId}`}`;
const LINK_RESULTS: Record<string, [boolean, string]> = {
  x: [true, "X account verified."],
  "x-cancelled": [false, "X sign-in was cancelled."],
  "x-failed": [false, "Could not verify your X account. Please try again."],
  "x-unavailable": [false, "X verification is not set up yet."],
};

/** The owner's X and Farcaster links. Each is proven by signing in to that account, never typed in. */
function LinkedAccounts({ address, socials }: { address: Address; socials: Social[] }) {
  const { isMiniApp, openLink } = useMiniapp();
  const { authenticated } = useWalletSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Platform>();
  const [request, setRequest] = useState<{ channelToken: string; url: string }>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["creator", address.toLowerCase()] });

  // X sends the browser back here with the result in ?linked=.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = LINK_RESULTS[url.searchParams.get("linked") ?? ""];
    if (!result) return;
    (result[0] ? notification.success : notification.error)(result[1]);
    url.searchParams.delete("linked");
    window.history.replaceState(null, "", url);
  }, []);

  // Polls the Sign In with Farcaster request until it is approved in Farcaster, for up to five minutes.
  useEffect(() => {
    if (!request) return;
    let stopped = false;
    const deadline = Date.now() + 5 * 60_000;
    void (async () => {
      while (!stopped && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (stopped) return;
        try {
          const result = await post("/api/social/farcaster", { action: "poll", channelToken: request.channelToken });
          if (result.pending) continue;
          notification.success("Farcaster account verified.");
          await refresh();
        } catch (error) {
          notification.error(error instanceof Error ? error.message : "Could not verify your Farcaster account.");
        }
        break;
      }
      if (!stopped) {
        setRequest(undefined);
        setBusy(undefined);
      }
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  async function verifyFarcaster() {
    setBusy("farcaster");
    try {
      if (!isMiniApp) return setRequest(await post("/api/social/farcaster", { action: "start" }));
      const { token } = await sdk.quickAuth.getToken();
      await post("/api/social/farcaster", { action: "quickauth", token });
      notification.success("Farcaster account verified.");
      await refresh();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not verify your Farcaster account.");
    }
    setBusy(current => (current === "farcaster" && !isMiniApp ? current : undefined));
  }

  async function unlink(platform: Platform) {
    setBusy(platform);
    try {
      const response = await fetch(`/api/social?platform=${platform}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Could not remove it.");
      await refresh();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not remove it.");
    }
    setBusy(undefined);
  }

  return (
    <section className="bq-demo-card">
      <h2>Verified accounts</h2>
      <p className="bq-demo-note">
        Sign in to your X or Farcaster account to show it on your profile with a verified badge.
      </p>
      {!authenticated && <p className="bq-demo-note">Sign in with your wallet first.</p>}
      <ul className="bq-creator-accounts">
        {(["farcaster", "x"] as const).map(platform => {
          const linked = socials.find(s => s.platform === platform);
          return (
            <li key={platform}>
              <span>{linked ? socialLabel(linked) : NAMES[platform]}</span>
              {linked ? (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={!!busy || !authenticated}
                  onClick={() => unlink(platform)}
                >
                  Remove
                </button>
              ) : platform === "farcaster" ? (
                <button className="btn btn-sm" disabled={!!busy || !authenticated} onClick={verifyFarcaster}>
                  {busy === platform ? "Waiting…" : "Verify Farcaster"}
                </button>
              ) : isMiniApp ? (
                // X does not load inside the Farcaster app, and its sign-in must finish in the browser that started it.
                <button
                  className="btn btn-sm"
                  onClick={() => openLink(`${window.location.origin}/creators/${address}`)}
                >
                  Open in browser to verify X
                </button>
              ) : authenticated ? (
                // A full navigation: the API route redirects the browser to X and X redirects back.
                <a className="btn btn-sm" href="/api/social/x">
                  Verify X
                </a>
              ) : (
                <button className="btn btn-sm" disabled>
                  Verify X
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {request && (
        <div className="bq-creator-siwf">
          <QRCodeSVG value={request.url} size={160} />
          <p className="bq-demo-note">
            Scan with your phone camera, or{" "}
            <a href={request.url} target="_blank" rel="noreferrer">
              open in Farcaster
            </a>
            , then approve the sign-in. It names this wallet so the link cannot be reused.
          </p>
        </div>
      )}
    </section>
  );
}

export function CreatorProfile({ address }: { address: Address }) {
  const { address: connected } = useAccount();
  const creator = useCreator(address);
  const [editing, setEditing] = useState(false);
  const isOwner = connected?.toLowerCase() === address.toLowerCase();
  const p = creator.data?.profile;

  if (creator.isError) return <p className="bq-demo-error">Could not load this creator.</p>;
  return (
    <>
      <header className="bq-creator-header">
        <Avatar address={address} profile={p} size={96} />
        <div>
          <p className="bq-soon-status">Basket creator · Testnet</p>
          <h1>{p?.name || short(address)}</h1>
          {p?.bio && <p className="bq-creator-bio">{p.bio}</p>}
          <p className="bq-details-meta">
            {[
              ...(creator.data?.socials ?? []).map(social => (
                <a
                  key={social.platform}
                  href={socialUrl(social)}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="bq-creator-verified"
                  title={`Verified: this wallet's owner signed in to this ${NAMES[social.platform]} account`}
                >
                  <CheckBadgeIcon width={14} height={14} aria-label="Verified" />
                  {socialLabel(social)}
                </a>
              )),
              p?.website && (
                <a key="web" href={p.website} target="_blank" rel="noreferrer nofollow">
                  {new URL(p.website).host}
                </a>
              ),
              p?.name && <span key="addr">{short(address)}</span>,
            ]
              .filter(Boolean)
              .flatMap((el, i) => (i ? [" · ", el] : [el]))}
          </p>
        </div>
        {isOwner && !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            {p ? "Edit profile" : "Set up profile"}
          </button>
        )}
      </header>

      {isOwner && editing && (
        <ProfileForm address={address} initial={p ?? EMPTY_PROFILE} onDone={() => setEditing(false)} />
      )}

      {isOwner && <LinkedAccounts address={address} socials={creator.data?.socials ?? []} />}

      <CreatorBaskets creator={address} />
    </>
  );
}

function ProfileForm({ address, initial, onDone }: { address: Address; initial: Profile; onDone: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const field = (key: keyof Profile) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  async function save(event: React.SyntheticEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const profile = cleanProfile(draft);
      const issuedAt = new Date().toISOString();
      const signature = await signMessageAsync({ message: profileMessage(address, profile, issuedAt) });
      await put(`/api/creators/${address}`, { profile, issuedAt, signature });
      await queryClient.invalidateQueries({ queryKey: ["creator", address.toLowerCase()] });
      notification.success("Profile saved.");
      onDone();
    } catch (error) {
      notification.error(error instanceof Error ? error.message.split("\n")[0] : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="bq-demo-card bq-creator-form" onSubmit={save}>
      <h2>Your creator profile</h2>
      <div className="bq-creator-picture">
        <Avatar address={address} profile={draft} size={64} />
        <label className="btn btn-sm">
          Choose picture
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setDraft({ ...draft, avatar: await shrinkImage(file) });
              } catch (error) {
                notification.error(error instanceof Error ? error.message : "Could not read this picture.");
              }
            }}
          />
        </label>
        {draft.avatar && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...draft, avatar: "" })}>
            Remove
          </button>
        )}
      </div>
      <label className="bq-manage-label">
        Name
        <input className="input input-sm w-full" maxLength={LIMITS.name} {...field("name")} />
      </label>
      <label className="bq-manage-label">
        Bio
        <textarea
          className="textarea textarea-sm w-full"
          rows={3}
          maxLength={LIMITS.bio}
          placeholder="What kind of baskets do you build?"
          {...field("bio")}
        />
      </label>
      <label className="bq-manage-label">
        Website
        <input className="input input-sm w-full" type="url" placeholder="https://" {...field("website")} />
      </label>
      <p className="bq-demo-note">
        Your wallet will ask you to sign the update. Signing is free and does not authorize any transaction.
      </p>
      <div className="bq-demo-row">
        <button className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? "Waiting for signature…" : "Sign and save"}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The basket's story, written by its creator. Shown to everyone; editable by the creator after signing. */
export function BasketDescription({ basket, creator }: { basket: Address; creator?: Address }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: ["basket-description", basket.toLowerCase()],
    queryFn: async () => {
      const response = await fetch(`/api/baskets/${basket}/description`);
      if (!response.ok) throw new Error("Could not load the description");
      return ((await response.json()) as { description: string }).description;
    },
  });
  const isCreator = !!creator && address?.toLowerCase() === creator.toLowerCase();
  const text = query.data ?? "";
  if (!text && !isCreator) return null;

  async function save() {
    setSaving(true);
    try {
      const description = cleanDescription(draft);
      const issuedAt = new Date().toISOString();
      const signature = await signMessageAsync({
        message: descriptionMessage(robinhoodTestnet.id, basket, description, issuedAt),
      });
      await put(`/api/baskets/${basket}/description`, { description, issuedAt, signature });
      await query.refetch();
      setDraft(undefined);
      notification.success("Description saved.");
    } catch (error) {
      notification.error(error instanceof Error ? error.message.split("\n")[0] : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bq-demo-card">
      <h2>About this basket</h2>
      {draft === undefined ? (
        <>
          {text ? (
            <p className="bq-creator-bio">{text}</p>
          ) : (
            <p className="bq-demo-note">Tell buyers the idea behind this basket.</p>
          )}
          {isCreator && (
            <div>
              <button className="btn btn-sm" onClick={() => setDraft(text)}>
                {text ? "Edit description" : "Add description"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <textarea
            className="textarea textarea-sm w-full"
            rows={4}
            maxLength={LIMITS.description}
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div className="bq-demo-row">
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
              {saving ? "Waiting for signature…" : "Sign and save"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setDraft(undefined)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** The creator's baskets, as the same cards as the baskets page, with Buy and Sell for the connected wallet. */
function CreatorBaskets({ creator }: { creator: Address }) {
  const { address } = useAccount();
  const baskets = useBasketRows(address);
  // Largest total value first, as on the baskets page.
  const rows = (baskets.data?.rows.filter(row => row.creator.toLowerCase() === creator.toLowerCase()) ?? []).sort(
    (a, b) => Number(totalValue(b.perShare, b.supply) - totalValue(a.perShare, a.supply)),
  );
  return (
    <section className="bq-creator-section" aria-labelledby="creator-baskets-title">
      <h2 id="creator-baskets-title">
        Baskets <span className="bq-count">{baskets.data ? rows.length : "…"}</span>
      </h2>
      {baskets.isPending && <p role="status">Loading baskets…</p>}
      {baskets.isError && (
        <p className="bq-demo-error" role="alert">
          Could not load baskets.{" "}
          <button className="btn btn-sm" onClick={() => baskets.refetch()}>
            Retry
          </button>
        </p>
      )}
      {baskets.data && !rows.length && <p className="bq-demo-note">No baskets yet.</p>}
      {baskets.data && !!rows.length && (
        <BasketGrid rows={rows} feesOn={baskets.data.feesOn} checkedAt={baskets.data.checkedAt} />
      )}
    </section>
  );
}
