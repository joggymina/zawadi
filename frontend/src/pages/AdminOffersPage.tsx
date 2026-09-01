import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { Offer } from "../api/types";
import { errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

export function AdminOffersPage() {
  const showToast = useToast();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [newOffer, setNewOffer] = useState({ title: "", description: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setOffers(await adminApi.listOffers());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addOffer() {
    if (!newOffer.title.trim() || !newOffer.description.trim()) {
      showToast("Title and description required");
      return;
    }
    try {
      const offer = await adminApi.createOffer(newOffer);
      setOffers((o) => [offer, ...o]);
      setNewOffer({ title: "", description: "" });
      showToast("Offer added");
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function removeOffer(id: string) {
    if (!window.confirm("Remove this offer?")) return;
    try {
      await adminApi.deleteOffer(id);
      setOffers((o) => o.filter((x) => x.id !== id));
      showToast("Offer removed");
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  if (error) {
    return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  }
  if (loading) {
    return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
          Grand offers
        </div>
        <Link to="/admin" style={{ fontSize: 13, color: "var(--green-deep)", textDecoration: "none" }}>
          ← Overview
        </Link>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
        Promotions shown to customers on the home screen.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {offers.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No offers yet.</div>
        )}
        {offers.map((o) => (
          <div
            key={o.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "var(--amber-pale)",
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{o.title}</div>
              <div style={{ fontSize: 11.5, color: "#7a5a2e" }}>{o.description}</div>
            </div>
            <button
              onClick={() => removeOffer(o.id)}
              aria-label="Remove offer"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--rust)",
                fontSize: 18,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Add offer</div>
        <input
          className="field-input"
          value={newOffer.title}
          onChange={(e) => setNewOffer((o) => ({ ...o, title: e.target.value }))}
          placeholder="Offer title"
        />
        <input
          className="field-input"
          value={newOffer.description}
          onChange={(e) => setNewOffer((o) => ({ ...o, description: e.target.value }))}
          placeholder="Description"
        />
        <button className="btn btn-primary" style={{ padding: "10px 0" }} onClick={addOffer}>
          Add offer
        </button>
      </div>
    </div>
  );
}