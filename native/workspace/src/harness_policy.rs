//! Current mandate ancestry and attenuation policy, separate from evaluation fixtures.
use super::citizen::now_ms;
use super::qharness::QH_MANDATES;
use super::*;
use std::collections::BTreeSet;

impl Workspace {
    /// Revalidate the persisted Role ancestry, including legacy records without parent metadata.
    pub(super) fn qh_active_mandate(&self, id: Qid) -> Result<(u64, Value), String> {
        let first = self.cen_row(id, QH_MANDATES)?;
        let mut next = Some(id);
        let mut seen = BTreeSet::new();
        let mut child: Option<Value> = None;
        let now = now_ms()?;
        while let Some(current) = next {
            if seen.len() >= 16 || !seen.insert(current) {
                return Err("PERMISSION_DENIED".into());
            }
            let (_, row) = self.cen_row(current, QH_MANDATES)?;
            if row["status"] != "active"
                || (!row["expiresAtMs"].is_null()
                    && row["expiresAtMs"].as_u64().is_none_or(|v| v <= now))
            {
                return Err("PERMISSION_DENIED".into());
            }
            if let Some(c) = child {
                for field in [
                    "permittedCapabilities",
                    "permittedEffects",
                    "permittedResources",
                ] {
                    let p = row[field].as_array().ok_or("PERMISSION_DENIED")?;
                    let values = c[field].as_array().ok_or("PERMISSION_DENIED")?;
                    if (field != "permittedResources" || !p.is_empty())
                        && (values.is_empty() || values.iter().any(|v| !p.contains(v)))
                    {
                        return Err("PERMISSION_DENIED".into());
                    }
                }
                for field in [
                    "maxModelCalls",
                    "maxToolCalls",
                    "maxTokens",
                    "maxWallTimeMs",
                ] {
                    if c["budget"][field].as_u64().ok_or("PERMISSION_DENIED")?
                        > row["budget"][field].as_u64().ok_or("PERMISSION_DENIED")?
                    {
                        return Err("PERMISSION_DENIED".into());
                    }
                }
                if c["budget"]["maxDelegationDepth"]
                    .as_u64()
                    .ok_or("PERMISSION_DENIED")?
                    >= row["budget"]["maxDelegationDepth"]
                        .as_u64()
                        .ok_or("PERMISSION_DENIED")?
                    || c["budget"]["maxCost"]["currency"] != row["budget"]["maxCost"]["currency"]
                    || c["budget"]["maxCost"]["amountMinorUnits"]
                        .as_i64()
                        .ok_or("PERMISSION_DENIED")?
                        > row["budget"]["maxCost"]["amountMinorUnits"]
                            .as_i64()
                            .ok_or("PERMISSION_DENIED")?
                {
                    return Err("PERMISSION_DENIED".into());
                }
                if let Some(expiry) = row["expiresAtMs"].as_u64() {
                    if c["expiresAtMs"].as_u64().is_none_or(|v| v > expiry) {
                        return Err("PERMISSION_DENIED".into());
                    }
                }
            }
            let db = self.db()?;
            let statement = db
                .revision_current(self.domain, self.owner, current, None)
                .map_err(err)?
                .and_then(|r| r.statement)
                .ok_or("PERMISSION_DENIED")?;
            let parents: Vec<_> = statement
                .roles
                .iter()
                .filter(|(role, _)| *role == super::qharness::ROLE_MANDATE)
                .map(|(_, target)| *target)
                .collect();
            if parents.len() > 1 {
                return Err("PERMISSION_DENIED".into());
            }
            next = parents.first().copied();
            child = Some(row);
        }
        Ok(first)
    }
}
