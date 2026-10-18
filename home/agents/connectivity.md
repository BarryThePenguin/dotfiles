# Connectivity failures (DNS / laptop sleep)

The symptom reads as "the service is down", but it usually isn't: after
unattended sleep, macOS loses its DNS config, so every Go binary (`gh`) and
name-based client (`curl`, `git`) fails while `dig` (which falls back to
the router) still works.

Run the probe first, investigate second:

    mise net:check

It prints `LAPTOP SLEPT`, `OFF-NETWORK`, or `cluster-side` (laptop
healthy, the cluster is at fault). Respond by diagnosis:

- `LAPTOP SLEPT`: the laptop _was_ asleep and woke with broken DNS — it is
  awake now, so the repair applies. Run `mise net:fix` (which repairs what
  it can and hands off any sudo steps it can't), then re-run the probe.
- `OFF-NETWORK`: stop retrying network tools; tell the user to reconnect.
  No repair command exists.
- `cluster-side` (or all-pass `laptop healthy`): the laptop is fine;
  investigate the failing cluster or service, not connectivity.

Done when: the probe prints one of the three states above and the matching
response has been carried out.
