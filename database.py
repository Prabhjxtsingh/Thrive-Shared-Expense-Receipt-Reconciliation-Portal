import sqlite3
from contextlib import contextmanager
from pathlib import Path

from flask import current_app, g


def db():
    if "db" not in g:
        connection = sqlite3.connect(current_app.config["DATABASE"], timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        g.db = connection
    return g.db


def close_db(_error):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def initialize():
    connection = db()
    connection.execute("PRAGMA journal_mode = WAL")
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version == 0:
        schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
        connection.executescript("BEGIN IMMEDIATE;\n" + schema + "\nPRAGMA user_version = 2;\nCOMMIT;")
    elif version == 1:
        with transaction() as conn:
            if conn.execute("PRAGMA user_version").fetchone()[0] == 1:
                conn.execute("ALTER TABLE receipts ADD COLUMN pdf_pages INTEGER")
                conn.execute("PRAGMA user_version = 2")


@contextmanager
def transaction():
    connection = db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
