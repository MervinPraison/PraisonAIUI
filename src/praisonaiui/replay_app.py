"""Ready-made aiui app that opens straight to PraisonAI Replay.

Usage (what ``praisonai replay view`` runs)::

    aiui run "$(python -c 'import praisonaiui.replay_app as m; print(m.__file__)')" \
        --style dashboard --host 127.0.0.1 --port 8090

then open ``http://127.0.0.1:8090/replay?run=<run_id>`` (``/#/replay?run=<run_id>``
is accepted too).  The trace directory follows ``PRAISONAI_TRACES_DIR`` >
``PRAISON_HOME/traces`` > ``~/.praison/traces``.
"""

from praisonaiui.features.replay import configure_replay_app

configure_replay_app()
