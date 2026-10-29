# FEAT-162 current acceptance policy

The current Owner authorization uses `scripts/feat162-soft-budget-meter.py`
(`FEAT-162-soft-budget-v3`). Twenty CNY is a soft stopping threshold: an admitted
request may cross it; after observing the threshold, no new paid request is sent.
A one-CNY per-model reservation is only an accounting estimate. No model output
cap or native-search hard fee bound is required or injected into requests.
Observed token usage uses the retained conservative rates; the report clearly
separates that estimate from an actual supplier bill. Unknown usage is retained
and stops the batch. Earlier ledgers remain closed and separate.

Each fresh E1–E7 batch retains the planned case sequence and at most 17 model
HTTP requests; Basic/Pro/Fetch each at most three. A repaired fresh batch carries
all current-operation prior spend and reports cumulative requests. It does not
reset the soft threshold or automatically retry a failed supplier request.

Normal Native UI owns the selected conversation, every tool approval and normal
cancellation. The operator checks the meter's settled, non-halted state before
clicking an approval. On halt, the operator cancels/rejects in the same actual App;
Native uses its own session mapping to reach the existing Host/Broker stop chain.
This avoids inventing a new identity lookup or granting the meter execution
permission. The meter blocks future model sends and does not forward an offending
tool chunk. Already sent calls retain incurred or unknown cost. Real App
rejection/cancellation is verified before the paid run, and receipt/normal stop
observations are recorded separately from unit tests.

The actual outbound model bytes, tools, include, tool_choice and system rules are
preserved. Volatile Runtime identities are separate from the product configuration
digest. The exact App receipt and explicit observation profile must match the
current generation. No model/Provider/Runtime executable is substituted.

The previous v2 hard-budget policy and `feat162_owner_stop.py` HTTP adapter remain
as historical, independently tested implementations. Their hard-bound gate does
not apply to v3. The old direct adapter consumes canonical Host GET-session and
interrupt paths and never grants approval; it is not used to guess new App
session IDs during the current UI acceptance.
