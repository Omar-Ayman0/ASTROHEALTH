# Version policy

Default: `astronaut-health-intelligence/engine/config.py` specifies hybrid-v2.0 / schema 1.0. Its API advertises 2.1.0, a different version dimension. The launcher uses this directory. Independent handoff v4.1.1 / hybrid-v2.1 / schema 1.0 is in `reference/engine-v4.1.1`, not imported by the active runtime. It adds evidence and adapter modules and all-five-signal sustained drift. Do not merge or deploy without compatibility tests. Engine v5 excluded.
