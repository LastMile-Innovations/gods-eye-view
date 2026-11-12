//! One manual account-local durable change consumer; never browser snapshot authority.
use super::*;

impl Workspace {
    fn inbox_id(&self) -> Qid {
        derive("activity-change-inbox", &self.domain.0)
    }
    pub(super) fn change_inbox(&self) -> Result<Value, String> {
        let Some(state) = self
            .db()?
            .consumer(self.domain, self.owner, self.inbox_id())
            .map_err(err)?
        else {
            return Ok(json!({"registered":false}));
        };
        Ok(
            json!({"registered":true,"revision":state.revision.to_string(),"acknowledged":state.acknowledged.to_string(),"closed":state.closed,"pending":state.pending.map(|p|json!({"id":p.id.to_canonical_string(),"after":p.after.to_string(),"through":p.through.to_string(),"snapshotSequence":p.snapshot_sequence.to_string()}))}),
        )
    }
    pub(super) fn poll_change_inbox(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key"])?;
        let key = parse(&input["key"])?;
        let id = self.inbox_id();
        {
            let mut db = self.db_mut()?;
            if db
                .consumer(self.domain, self.owner, id)
                .map_err(err)?
                .is_none()
            {
                receipt(
                    db.create_consumer(
                        self.domain,
                        self.owner,
                        derive("activity-consumer-create", &self.domain.0),
                        id,
                        0,
                    ),
                    id,
                )?;
            }
            match db
                .poll_consumer(self.domain, self.owner, key, id, 64)
                .map_err(err)?
            {
                quanta_core::ConsumerPoll::Ready(_) => {}
                quanta_core::ConsumerPoll::Conflict => return Err("CONFLICT".into()),
                quanta_core::ConsumerPoll::Aborted(_) => return Err("INVALID".into()),
                quanta_core::ConsumerPoll::UnknownOutcome => return Err("UNKNOWN_OUTCOME".into()),
            }
        }
        self.change_inbox()
    }
    pub(super) fn ack_change_inbox(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "expected", "delivery"])?;
        let key = parse(&input["key"])?;
        let delivery = parse(&input["delivery"])?;
        let text = input["expected"].as_str().ok_or("INVALID")?;
        let expected = text.parse::<u64>().map_err(|_| "INVALID")?;
        if text != expected.to_string() {
            return Err("INVALID".into());
        }
        let id = self.inbox_id();
        receipt(
            self.db_mut()?
                .ack_consumer(self.domain, self.owner, key, id, expected, delivery),
            id,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inbox_requires_explicit_ack_and_recovers_after_native_restart() {
        let root = tempfile::tempdir().unwrap();
        let w = Workspace::open(root.path()).unwrap();
        assert_eq!(
            w.execute(json!({"op":"changeInbox"})).unwrap()["registered"],
            false
        );
        let first = w
            .execute(json!({"op":"pollChangeInbox","key":"14141414141414141414141414141414"}))
            .unwrap();
        assert_eq!(first["acknowledged"], "0");
        assert!(first["pending"].is_object());
        assert!(!first.to_string().contains("objects"));
        assert!(!first.to_string().contains("notices"));
        drop(w);
        let w = Workspace::open(root.path()).unwrap();
        assert_eq!(w.execute(json!({"op":"changeInbox"})).unwrap(), first);
        assert_eq!(
            w.execute(json!({"op":"pollChangeInbox","key":"14141414141414141414141414141414"}))
                .unwrap(),
            first
        );
        let command = json!({"op":"ackChangeInbox","key":"15151515151515151515151515151515","expected":first["revision"],"delivery":first["pending"]["id"]});
        let ack = w.execute(command.clone()).unwrap();
        assert_eq!(w.execute(command).unwrap(), ack);
        let status = w.execute(json!({"op":"changeInbox"})).unwrap();
        assert_eq!(status["acknowledged"], first["pending"]["through"]);
        assert!(status["pending"].is_null());
        assert!(w
            .execute(json!({"op":"changeInbox","principal":"fake"}))
            .is_err());
        assert_eq!(
            w.execute(json!({"op":"operations"})).unwrap()["changeInbox"],
            status
        );
    }
}
