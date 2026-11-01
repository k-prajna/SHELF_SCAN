from __future__ import annotations

import base64
import asyncio
import json
import math
import logging
import os
import re
import secrets
import smtplib
from pathlib import Path
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Generator
from urllib.parse import urlparse
from uuid import uuid4

import bcrypt
import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel, Field, field_validator
from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, create_engine, delete, func, inspect, select, text, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("shelfscan")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    if ENVIRONMENT == "production":
        raise RuntimeError("JWT_SECRET_KEY must be configured in production")
    JWT_SECRET_KEY = "local-development-secret-change-before-deploy"
JWT_ALGORITHM = "HS256"
JWT_TTL_MINUTES = int(os.getenv("JWT_TTL_MINUTES", "60"))
OTP_TTL_MINUTES = int(os.getenv("OTP_TTL_MINUTES", "10"))
OTP_RESEND_SECONDS = int(os.getenv("OTP_RESEND_SECONDS", "60"))
ACTIVITY_UPDATE_SECONDS = int(os.getenv("ACTIVITY_UPDATE_SECONDS", "300"))
ACTIVE_USER_WINDOW_MINUTES = int(os.getenv("ACTIVE_USER_WINDOW_MINUTES", "30"))
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", "").split(",")
    if email.strip()
}


MAX_UPLOAD_BYTES = 10 * 1024 * 1024

database_url = os.getenv("DATABASE_URL")
if not database_url:
    if ENVIRONMENT == "production":
        raise RuntimeError("DATABASE_URL must be configured in production")
    database_url = "sqlite:///./shelfscan.db"
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine_options: dict[str, Any] = {"pool_pre_ping": True}
if database_url.startswith("sqlite:"):
    engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verification_code_hash: Mapped[str | None] = mapped_column(String(255))
    verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reset_code_hash: Mapped[str | None] = mapped_column(String(255))
    reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    role: Mapped[str] = mapped_column(String(20), default="user", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LoginHistory(Base):
    __tablename__ = "login_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    logout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    favourite_genres: Mapped[list[str]] = mapped_column(JSON, default=list)
    favourite_authors: Mapped[list[str]] = mapped_column(JSON, default=list)
    reading_categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    reading_habits: Mapped[list[str]] = mapped_column(JSON, default=list)
    books_enjoyed_previously: Mapped[list[str]] = mapped_column(JSON, default=list)


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), index=True)
    author: Mapped[str] = mapped_column(String(300), index=True)
    genre: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    cover: Mapped[str] = mapped_column(Text, default="")
    publisher: Mapped[str] = mapped_column(String(300), default="")
    publication_year: Mapped[int | None] = mapped_column(Integer)
    match_score: Mapped[int] = mapped_column(Integer, default=0)
    recommendation_reason: Mapped[str] = mapped_column(Text, default="")
    ai_explanation: Mapped[str] = mapped_column(Text, default="")
    isbn: Mapped[str | None] = mapped_column(String(20))
    average_rating: Mapped[float | None] = mapped_column(Float)
    ratings_count: Mapped[int | None] = mapped_column(Integer)
    editions: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    retailer_name: Mapped[str | None] = mapped_column(String(120))
    retailer_url: Mapped[str | None] = mapped_column(Text)
    price_amount: Mapped[float | None] = mapped_column(Float)
    price_currency: Mapped[str | None] = mapped_column(String(8))
    price_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_source: Mapped[str] = mapped_column(String(30), default="catalog", nullable=False)


class ScannedShelf(Base):
    __tablename__ = "scanned_shelves"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="Bookshelf scan")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ScannedBook(Base):
    __tablename__ = "scanned_books"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    scan_id: Mapped[str] = mapped_column(ForeignKey("scanned_shelves.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[str | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    author: Mapped[str] = mapped_column(String(300), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0)
    uncertain: Mapped[bool] = mapped_column(Boolean, default=False)


class UserLibrary(Base):
    __tablename__ = "user_library"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_user_library_book"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="want_to_read")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FavouriteBook(Base):
    __tablename__ = "favourite_books"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_favourite_book"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_cart_user_book"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(20))
    match_score: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ReadingHistory(Base):
    __tablename__ = "reading_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class BookEmbedding(Base):
    __tablename__ = "embeddings"

    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), primary_key=True)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(1536).with_variant(JSON(), "sqlite"),
        nullable=True,
    )


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class EmailPayload(BaseModel):
    email: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> str:
        normalized = str(value).strip().lower()
        if not is_valid_email(normalized):
            raise ValueError("Please enter a valid email address.")
        return normalized


class RegisterPayload(EmailPayload):
    full_name: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=8, max_length=72)
    favourite_genres: list[str] = Field(default_factory=list)

    @field_validator("password")
    @classmethod
    def password_is_bcrypt_safe(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be no more than 72 bytes.")
        return value


class LoginPayload(EmailPayload):
    password: str = Field(..., min_length=1, max_length=72)
    remember_me: bool = False

    @field_validator("password")
    @classmethod
    def password_is_bcrypt_safe(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be no more than 72 bytes.")
        return value


class VerifyPayload(EmailPayload):
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResetPasswordPayload(VerifyPayload):
    new_password: str = Field(..., min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def reset_password_is_bcrypt_safe(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be no more than 72 bytes.")
        return value


class PreferencesPayload(BaseModel):
    favourite_genres: list[str] = Field(default_factory=list)
    favourite_authors: list[str] = Field(default_factory=list)
    reading_categories: list[str] = Field(default_factory=list)
    reading_habits: list[str] = Field(default_factory=list)
    books_enjoyed_previously: list[str] = Field(default_factory=list)


class LibrarySavePayload(BaseModel):
    book_id: str
    status: str = "want_to_read"


class RecommendationRequest(BaseModel):
    books: list[str] = Field(default_factory=list)


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=500)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Please enter a question about books.")
        return normalized


class ScanPayload(BaseModel):
    name: str = Field(default="Bookshelf scan", max_length=200)


class CartItemPayload(BaseModel):
    book_id: str = Field(min_length=1, max_length=64)
    quantity: int = Field(default=1, ge=1, le=99)


class CartQuantityPayload(BaseModel):
    quantity: int = Field(ge=1, le=99)


EMAIL_PATTERN = re.compile(
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)


def is_valid_email(value: str) -> bool:
    if len(value) > 254 or EMAIL_PATTERN.fullmatch(value) is None:
        return False
    local, domain = value.rsplit("@", 1)
    return len(local) <= 64 and len(domain) <= 253


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Database operation failed")
        raise HTTPException(status_code=503, detail="Database is temporarily unavailable") from exc
    finally:
        session.close()


def hash_secret(value: str) -> str:
    return bcrypt.hashpw(value.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_secret(value: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(value.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def as_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def create_access_token(
    user: User,
    remember_me: bool = False,
    session_id: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    expires_in = timedelta(days=30) if remember_me else timedelta(minutes=JWT_TTL_MINUTES)
    payload = {
        "sub": user.id,
        "jti": session_id or str(uuid4()),
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication is required")
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        token_id = payload.get("jti")
        issued_at = payload.get("iat")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Your session is invalid or has expired") from exc
    user = db.get(User, user_id) if user_id else None
    if not user or not token_id or db.get(RevokedToken, token_id) or not user.email_verified:
        raise HTTPException(status_code=401, detail="Your session is invalid or has expired")
    password_changed_at = as_utc(user.password_changed_at)
    if password_changed_at is not None and (
        not isinstance(issued_at, (int, float))
        or datetime.fromtimestamp(issued_at, tz=timezone.utc) < password_changed_at
    ):
        raise HTTPException(status_code=401, detail="Your session is invalid or has expired")
    now = datetime.now(timezone.utc)
    last_active = as_utc(user.last_active_at)
    if last_active is None or (now - last_active).total_seconds() >= ACTIVITY_UPDATE_SECONDS:
        db.execute(
            update(User)
            .where(
                User.id == user.id,
                (User.last_active_at.is_(None)) | (User.last_active_at < now - timedelta(seconds=ACTIVITY_UPDATE_SECONDS)),
            )
            .values(last_active_at=now)
        )
        db.commit()
        user.last_active_at = now
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    return user


def send_email(recipient: str, subject: str, body: str) -> str | None:
    host = os.getenv("EMAIL_HOST")
    username = os.getenv("EMAIL_USERNAME")
    password = os.getenv("EMAIL_PASSWORD")
    sender = os.getenv("EMAIL_FROM", username or "")
    if not host or not username or not password or not sender:
        if ENVIRONMENT == "production":
            raise HTTPException(status_code=503, detail="Email delivery is not configured")
        logger.warning("Email settings are missing; development code for %s: %s", recipient, body)
        match = re.search(r"\b(\d{6})\b", body)
        return match.group(1) if match else None

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(body)
    port = int(os.getenv("EMAIL_PORT", "587"))
    try:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.exception("Email delivery failed")
        raise HTTPException(status_code=503, detail="Could not send email. Please try again later.") from exc
    return None


def issue_code(user: User, purpose: str) -> tuple[str, str | None]:
    now = datetime.now(timezone.utc)
    last_sent = as_utc(user.verification_sent_at if purpose == "verify" else user.reset_sent_at)
    if last_sent and (now - last_sent).total_seconds() < OTP_RESEND_SECONDS:
        wait_seconds = OTP_RESEND_SECONDS - int((now - last_sent).total_seconds())
        raise HTTPException(status_code=429, detail=f"Please wait {wait_seconds} seconds before requesting another code.")

    code = f"{secrets.randbelow(1_000_000):06d}"
    if purpose == "verify":
        user.verification_code_hash = hash_secret(code)
        user.verification_expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)
        user.verification_sent_at = now
        user.verification_attempts = 0
        subject = "Verify your SHELF SCAN email"
        message = f"Your SHELF SCAN verification code is {code}. It expires in {OTP_TTL_MINUTES} minutes."
    else:
        user.reset_code_hash = hash_secret(code)
        user.reset_expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)
        user.reset_sent_at = now
        user.reset_attempts = 0
        subject = "Reset your SHELF SCAN password"
        message = f"Your SHELF SCAN password reset code is {code}. It expires in {OTP_TTL_MINUTES} minutes."

    development_code = send_email(user.email, subject, message)
    return code, development_code


def serialize_book(book: Book) -> dict[str, Any]:
    price_updated_at = as_utc(book.price_updated_at)
    current_price = bool(
        book.price_amount is not None
        and book.price_currency
        and book.retailer_url
        and price_updated_at
        and price_updated_at >= datetime.now(timezone.utc) - timedelta(hours=24)
    )
    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "genre": book.genre,
        "description": book.description,
        "cover": book.cover,
        "publisher": book.publisher,
        "publication_year": book.publication_year,
        "match_score": book.match_score,
        "recommendation_reason": book.recommendation_reason,
        "ai_explanation": book.ai_explanation,
        "isbn": book.isbn,
        "average_rating": book.average_rating,
        "ratings_count": book.ratings_count,
        "editions": book.editions or [],
        "retailer_name": book.retailer_name if current_price else None,
        "retailer_url": book.retailer_url if current_price else None,
        "price_amount": book.price_amount if current_price else None,
        "price_currency": book.price_currency if current_price else None,
        "price_updated_at": price_updated_at.isoformat() if current_price else None,
        "metadata_source": book.metadata_source,
    }


def serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
    }


def normalized_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


async def lookup_google_book(title: str, author: str, api_key: str, db: Session) -> Book | None:
    query = f'intitle:"{title}"'
    if author:
        query += f' inauthor:"{author}"'
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://www.googleapis.com/books/v1/volumes",
                params={"q": query, "key": api_key, "maxResults": 5},
            )
            response.raise_for_status()
            candidates = response.json().get("items", [])
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("Google Books metadata lookup failed")
        raise HTTPException(status_code=502, detail="Book metadata lookup is temporarily unavailable.") from exc

    match = next(
        (
            item.get("volumeInfo", {})
            for item in candidates
            if normalized_title(item.get("volumeInfo", {}).get("title", "")) == normalized_title(title)
        ),
        None,
    )
    if not match:
        return None

    google_id = next(
        item.get("id")
        for item in candidates
        if normalized_title(item.get("volumeInfo", {}).get("title", "")) == normalized_title(title)
    )
    published_date = str(match.get("publishedDate", ""))
    book = Book(
        id=f"google_{google_id or uuid4().hex}",
        title=str(match.get("title", title))[:300],
        author=", ".join(match.get("authors", []))[:300] or author,
        genre=str((match.get("categories") or ["Uncategorized"])[0])[:120],
        description=str(match.get("description", "")),
        cover=str(match.get("imageLinks", {}).get("thumbnail", "")),
        publisher=str(match.get("publisher", ""))[:300],
        publication_year=int(published_date[:4]) if published_date[:4].isdigit() else None,
    )
    db.add(book)
    db.flush()
    return book


async def create_embeddings(texts: list[str]) -> list[list[float]]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI recommendations are not configured on this server.")
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
                    "input": texts,
                },
            )
            response.raise_for_status()
            items = response.json()["data"]
            return [item["embedding"] for item in sorted(items, key=lambda item: item["index"])]
    except (httpx.HTTPError, KeyError, TypeError) as exc:
        logger.exception("OpenAI embeddings request failed")
        raise HTTPException(status_code=502, detail="AI recommendations are temporarily unavailable.") from exc


def cosine_similarity(left: list[float], right: list[float]) -> float:
    dot_product = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot_product / (left_norm * right_norm)


SEED_BOOKS = [
    {
        "id": "b_1", "title": "The Silent Patient", "author": "Alex Michaelides",
        "genre": "Psychological Thriller",
        "description": "A psychological thriller about a woman who stops speaking after a violent act.",
        "cover": "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=800&q=80",
        "publisher": "Celadon Books", "publication_year": 2019, "match_score": 96,
        "recommendation_reason": "You enjoy tense, character-driven thrillers with a sharp psychological edge.",
        "ai_explanation": "Strong alignment with mystery and suspense preferences.",
    },
    {
        "id": "b_2", "title": "Leave No Trace", "author": "M. M. DeWitt", "genre": "Mystery",
        "description": "A haunting mystery filled with layered secrets and environmental tension.",
        "cover": "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=800&q=80",
        "publisher": "Little, Brown", "publication_year": 2021, "match_score": 92,
        "recommendation_reason": "This matches the slow-burn suspense and atmospheric mood you gravitate toward.",
        "ai_explanation": "Its pacing and atmospheric nuance fit your preferred reading rhythm.",
    },
    {
        "id": "b_3", "title": "The Midnight Library", "author": "Matt Haig", "genre": "Fantasy",
        "description": "A reflective fantasy that blends life choices with emotional resonance and wonder.",
        "cover": "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=800&q=80",
        "publisher": "Viking", "publication_year": 2020, "match_score": 88,
        "recommendation_reason": "You like emotionally rich narratives with speculative elements and a human core.",
        "ai_explanation": "An uplifting but thoughtful match for your current reading personality.",
    },
    {
        "id": "b_4", "title": "The Thursday Murder Club", "author": "Richard Osman",
        "genre": "Cozy Mystery",
        "description": "A witty and warm mystery featuring a retirement village sleuthing circle.",
        "cover": "https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=800&q=80",
        "publisher": "Pamela Dorman", "publication_year": 2020, "match_score": 84,
        "recommendation_reason": "A light but cleverly plotted mystery with a strong community atmosphere.",
        "ai_explanation": "A strong fit when you want something intelligent, accessible, and comforting.",
    },
    {
        "id": "b_5", "title": "The House in the Cerulean Sea", "author": "TJ Klune",
        "genre": "Fantasy",
        "description": "A cozy magical adventure about found family and self-discovery.",
        "cover": "https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=800&q=80",
        "publisher": "Tor", "publication_year": 2020, "match_score": 81,
        "recommendation_reason": "Warm and uplifting without losing the emotional depth you enjoy.",
        "ai_explanation": "A good balance of comfort and character-driven depth.",
    },
]

app = FastAPI(title="Shelf Scan API", version="1.0.0")
allowed_origins = {
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_URL", "http://localhost:5173").split(",")
    if origin.strip()
}
allowed_origins.update({
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://shelf-scan-dmq6.vercel.app",
})
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
def initialize_database() -> None:
    try:
        with engine.begin() as connection:
            if engine.dialect.name == "postgresql":
                connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            Base.metadata.create_all(bind=connection)
            user_columns = {column["name"] for column in inspect(connection).get_columns("users")}
            user_migrations = {
                "verification_attempts": "INTEGER NOT NULL DEFAULT 0",
                "reset_attempts": "INTEGER NOT NULL DEFAULT 0",
                "role": "VARCHAR(20) NOT NULL DEFAULT 'user'",
                "last_login_at": "TIMESTAMP WITH TIME ZONE",
                "last_active_at": "TIMESTAMP WITH TIME ZONE",
                "password_changed_at": "TIMESTAMP WITH TIME ZONE",
            }
            if engine.dialect.name == "postgresql":
                migration_file = Path(__file__).parent / "migrations" / "001_activity_and_book_commerce.sql"
                for statement in migration_file.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(text(statement))
            else:
                connection.execute(text(
                    "CREATE TABLE IF NOT EXISTS schema_migrations "
                    "(version VARCHAR(64) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)"
                ))
                for name, column_type in user_migrations.items():
                    if name not in user_columns:
                        connection.execute(text(
                            f"ALTER TABLE users ADD COLUMN {name} {column_type}"
                        ))
                book_columns = {column["name"] for column in inspect(connection).get_columns("books")}
                for name, column_type in {
                    "isbn": "VARCHAR(20)",
                    "average_rating": "FLOAT",
                    "ratings_count": "INTEGER",
                    "editions": "JSON",
                    "retailer_name": "VARCHAR(120)",
                    "retailer_url": "TEXT",
                    "price_amount": "FLOAT",
                    "price_currency": "VARCHAR(8)",
                    "price_updated_at": "DATETIME",
                    "metadata_source": "VARCHAR(30) NOT NULL DEFAULT 'catalog'",
                }.items():
                    if name not in book_columns:
                        connection.execute(text(
                            f"ALTER TABLE books ADD COLUMN {name} {column_type}"
                        ))
                connection.execute(text(
                    "INSERT OR IGNORE INTO schema_migrations(version) "
                    "VALUES ('001_activity_and_book_commerce')"
                ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_last_active_at ON users(last_active_at)"
            ))
            if ADMIN_EMAILS:
                connection.execute(
                    update(User)
                    .where(User.email.in_(ADMIN_EMAILS))
                    .values(role="admin")
                )
        with SessionLocal() as db:
            for entry in SEED_BOOKS:
                if db.get(Book, entry["id"]) is None:
                    db.add(Book(**entry))
            db.commit()
    except SQLAlchemyError:
        logger.exception("Database initialization failed")
        raise


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Shelf Scan API"}


@app.get("/health")
def health() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.exception("Database health check failed")
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ok"}


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    user = User(
        full_name=payload.full_name.strip(),
        email=payload.email,
        password_hash=hash_secret(payload.password),
        role="admin" if payload.email in ADMIN_EMAILS else "user",
    )
    db.add(user)
    db.flush()
    db.add(UserPreference(user_id=user.id, favourite_genres=payload.favourite_genres))
    development_code: str | None = None
    try:
        _, development_code = issue_code(user, "verify")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
    except HTTPException:
        db.rollback()
        raise
    response: dict[str, Any] = {
        "verification_required": True,
        "email": user.email,
        "message": "Check your email for a verification code.",
    }
    if ENVIRONMENT != "production" and development_code:
        response["development_code"] = development_code
    return response


@app.post("/api/auth/verify-email")
def verify_email(payload: VerifyPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user:
        raise HTTPException(status_code=400, detail="The verification code is invalid or expired.")
    expires_at = as_utc(user.verification_expires_at)
    if (
        user.email_verified
        or not expires_at
        or expires_at < datetime.now(timezone.utc)
        or not verify_secret(payload.code, user.verification_code_hash)
    ):
        if user.verification_code_hash and not user.email_verified:
            user.verification_attempts += 1
            if user.verification_attempts >= 5:
                user.verification_code_hash = None
                user.verification_expires_at = None
            db.commit()
        raise HTTPException(status_code=400, detail="The verification code is invalid or expired.")
    user.email_verified = True
    user.verification_code_hash = None
    user.verification_expires_at = None
    user.verification_attempts = 0
    db.commit()
    preference = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    if preference and preference.favourite_genres:
        for book in db.scalars(select(Book).where(Book.genre.in_(preference.favourite_genres))).all():
            score = min(98, 75 + len(preference.favourite_genres) * 5)
            db.add(Recommendation(
                user_id=user.id,
                book_id=book.id,
                category="BUY IT" if score >= 85 else "SAVE IT",
                match_score=score,
                reason="Genre overlap with your saved reading preferences.",
            ))
        db.commit()
    session_id = str(uuid4())
    now = datetime.now(timezone.utc)
    user.last_login_at = now
    user.last_active_at = now
    db.add(LoginHistory(user_id=user.id, session_id=session_id, login_at=now))
    db.commit()
    return {
        "token": create_access_token(user, session_id=session_id),
        "user": serialize_user(user),
    }


@app.post("/api/auth/resend-verification")
def resend_verification(payload: EmailPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or user.email_verified:
        return {"message": "If this account needs verification, a new code has been sent."}
    _, development_code = issue_code(user, "verify")
    db.commit()
    response: dict[str, Any] = {"message": "If this account needs verification, a new code has been sent."}
    if ENVIRONMENT != "production" and development_code:
        response["development_code"] = development_code
    return response


@app.post("/api/auth/login")
def login(payload: LoginPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_secret(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before signing in.")
    session_id = str(uuid4())
    now = datetime.now(timezone.utc)
    user.last_login_at = now
    user.last_active_at = now
    db.add(LoginHistory(user_id=user.id, session_id=session_id, login_at=now))
    db.commit()
    return {
        "token": create_access_token(user, payload.remember_me, session_id),
        "user": serialize_user(user),
    }


@app.post("/api/auth/logout")
def logout(
    authorization: str = Header(alias="Authorization"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Your session is invalid or has expired") from exc
    token_id = payload.get("jti")
    expiry = payload.get("exp")
    if token_id and expiry:
        history = db.scalar(select(LoginHistory).where(LoginHistory.session_id == token_id))
        if history and history.session_status == "active":
            history.logout_at = datetime.now(timezone.utc)
            history.session_status = "logged_out"
        db.add(RevokedToken(
            jti=token_id,
            user_id=user.id,
            expires_at=datetime.fromtimestamp(expiry, tz=timezone.utc),
        ))
        db.commit()
    return {"message": "Signed out successfully."}


@app.get("/api/auth/me")
def me(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return serialize_user(user)


@app.post("/api/auth/forgot-password")
def forgot_password(payload: EmailPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = db.scalar(select(User).where(User.email == payload.email))
    response: dict[str, Any] = {"message": "If the account exists, a reset code has been sent."}
    if user:
        _, development_code = issue_code(user, "reset")
        db.commit()
        if ENVIRONMENT != "production" and development_code:
            response["development_code"] = development_code
    return response


@app.post("/api/auth/reset-password")
def reset_password(payload: ResetPasswordPayload, db: Session = Depends(get_db)) -> dict[str, str]:
    user = db.scalar(select(User).where(User.email == payload.email))
    expires_at = as_utc(user.reset_expires_at if user else None)
    if (
        not user
        or not expires_at
        or expires_at < datetime.now(timezone.utc)
        or not verify_secret(payload.code, user.reset_code_hash)
    ):
        if user and user.reset_code_hash:
            user.reset_attempts += 1
            if user.reset_attempts >= 5:
                user.reset_code_hash = None
                user.reset_expires_at = None
            db.commit()
        raise HTTPException(status_code=400, detail="The reset code is invalid or expired.")
    now = datetime.now(timezone.utc)
    user.password_hash = hash_secret(payload.new_password)
    user.password_changed_at = now
    user.reset_code_hash = None
    user.reset_expires_at = None
    user.reset_attempts = 0
    sessions = db.scalars(
        select(LoginHistory).where(
            LoginHistory.user_id == user.id,
            LoginHistory.session_status == "active",
        )
    ).all()
    for session in sessions:
        session.logout_at = now
        session.session_status = "password_reset"
        db.add(RevokedToken(
            jti=session.session_id,
            user_id=user.id,
            expires_at=now + timedelta(days=30),
        ))
    db.commit()
    return {"message": "Your password was reset. You can now sign in."}


@app.get("/api/preferences")
def get_preferences(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    preference = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    if not preference:
        return {}
    return {
        "favourite_genres": preference.favourite_genres,
        "favourite_authors": preference.favourite_authors,
        "reading_categories": preference.reading_categories,
        "reading_habits": preference.reading_habits,
        "books_enjoyed_previously": preference.books_enjoyed_previously,
    }


@app.put("/api/preferences")
def update_preferences(
    payload: PreferencesPayload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    preference = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    if not preference:
        preference = UserPreference(user_id=user.id)
        db.add(preference)
    for field, value in payload.model_dump().items():
        setattr(preference, field, value)
    db.commit()
    return payload.model_dump()


@app.post("/api/scanner/analyze")
@app.post("/api/scanner/upload")
async def analyze_bookshelf(
    file: UploadFile = File(...),
    name: str = Query(default="Bookshelf scan", max_length=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller.")
    mime_type = file.content_type or ""
    if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP bookshelf image.")
    if not (
        content.startswith(b"\xff\xd8\xff")
        or content.startswith(b"\x89PNG\r\n\x1a\n")
        or (content.startswith(b"RIFF") and content[8:12] == b"WEBP")
    ):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid supported image.")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Bookshelf recognition is not configured on this server.")

    encoded = base64.b64encode(content).decode("ascii")
    image_data_url = f"data:{mime_type};base64,{encoded}"
    prompt = (
        "Identify only books whose visible cover or spine text is readable. Never guess or invent titles/authors. "
        "Return JSON only with {books:[{title,author,confidence}]}. Confidence must be 0..1. "
        "Use an empty string when the author is unreadable."
    )
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini"),
                    "response_format": {"type": "json_object"},
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_data_url}},
                        ],
                    }],
                },
            )
            response.raise_for_status()
            ai_result = response.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
        logger.exception("Bookshelf vision request failed")
        raise HTTPException(status_code=502, detail="Could not analyze this bookshelf image.") from exc

    try:
        decoded_result = json.loads(ai_result)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="The recognition service returned invalid book data.") from exc
    detected = decoded_result.get("books") if isinstance(decoded_result, dict) else None
    if not isinstance(detected, list):
        raise HTTPException(status_code=502, detail="The recognition service returned invalid book data.")

    scan = ScannedShelf(user_id=user.id, name=name.strip() or "Bookshelf scan")
    db.add(scan)
    db.flush()
    recognized_books: list[dict[str, Any]] = []
    for candidate in detected[:30]:
        if not isinstance(candidate, dict):
            raise HTTPException(status_code=502, detail="The recognition service returned invalid book data.")
        title_value = candidate.get("title", "")
        author_value = candidate.get("author", "")
        confidence_value = candidate.get("confidence", 0)
        if (
            not isinstance(title_value, str)
            or not isinstance(author_value, str)
            or isinstance(confidence_value, bool)
            or not isinstance(confidence_value, (int, float))
            or not math.isfinite(confidence_value)
            or not 0 <= confidence_value <= 1
        ):
            raise HTTPException(status_code=502, detail="The recognition service returned invalid book data.")
        title = title_value.strip()
        author = author_value.strip()
        confidence = float(confidence_value)
        if not title:
            continue
        matched_book = None
        if confidence >= 0.6:
            matched_book = db.scalar(
                select(Book).where(Book.title.ilike(title))
            )
            google_key = os.getenv("GOOGLE_BOOKS_API_KEY")
            if not matched_book and google_key:
                matched_book = await lookup_google_book(title, author, google_key, db)
        scanned_book = ScannedBook(
            scan_id=scan.id,
            book_id=matched_book.id if matched_book else None,
            title=title,
            author=author,
            confidence=confidence,
            uncertain=confidence < 0.7,
        )
        db.add(scanned_book)
        recognized_books.append({
            "book_id": matched_book.id if matched_book else None,
            "title": title,
            "author": author,
            "confidence": confidence,
            "uncertain": confidence < 0.7,
            "metadata": serialize_book(matched_book) if matched_book else None,
        })
    db.commit()
    return {
        "id": scan.id,
        "title": scan.name,
        "created_at": scan.created_at.isoformat(),
        "recognized_books": recognized_books,
        "status": "completed",
    }


@app.get("/api/scanner/history")
def scanner_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    scans = db.scalars(
        select(ScannedShelf).where(ScannedShelf.user_id == user.id).order_by(ScannedShelf.created_at.desc())
    ).all()
    result = []
    for scan in scans:
        scan_books = db.scalars(select(ScannedBook).where(ScannedBook.scan_id == scan.id)).all()
        result.append({
            "id": scan.id,
            "name": scan.name,
            "created_at": scan.created_at.isoformat(),
            "books": [{"title": item.title, "author": item.author, "confidence": item.confidence} for item in scan_books],
        })
    return result


@app.get("/api/books")
def get_books(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [serialize_book(book) for book in db.scalars(select(Book).order_by(Book.title)).all()]


def _is_user_active(user: User, now: datetime) -> bool:
    last_active = as_utc(user.last_active_at)
    return bool(
        user.email_verified
        and last_active
        and last_active >= now - timedelta(minutes=ACTIVE_USER_WINDOW_MINUTES)
    )


def _serialize_admin_user(user: User, now: datetime) -> dict[str, Any]:
    is_active = _is_user_active(user, now)
    return {
        **serialize_user(user),
        "is_active": is_active,
        "account_status": "unverified" if not user.email_verified else "active" if is_active else "inactive",
        "email_verified": user.email_verified,
    }


def _serialize_login_history(entry: LoginHistory, user: User) -> dict[str, Any]:
    return {
        "id": entry.id,
        "user_id": user.id,
        "user_name": user.full_name,
        "email": user.email,
        "login_at": entry.login_at.isoformat(),
        "logout_at": entry.logout_at.isoformat() if entry.logout_at else None,
        "session_status": entry.session_status,
    }


@app.get("/api/admin/dashboard")
def admin_dashboard(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=ACTIVE_USER_WINDOW_MINUTES)
    total_users = int(db.scalar(select(func.count(User.id))) or 0)
    active_users = int(db.scalar(
        select(func.count(User.id)).where(
            User.email_verified.is_(True),
            User.last_active_at >= cutoff,
        )
    ) or 0)
    recent_users = db.scalars(
        select(User).order_by(User.created_at.desc()).limit(10)
    ).all()
    recent_history = db.execute(
        select(LoginHistory, User)
        .join(User, User.id == LoginHistory.user_id)
        .order_by(LoginHistory.login_at.desc())
        .limit(20)
    ).all()
    return {
        "total_users": total_users,
        "active_users": active_users,
        "inactive_users": total_users - active_users,
        "activity_window_minutes": ACTIVE_USER_WINDOW_MINUTES,
        "recently_registered": [_serialize_admin_user(user, now) for user in recent_users],
        "recent_login_history": [
            _serialize_login_history(entry, user) for entry, user in recent_history
        ],
    }


@app.get("/api/admin/users")
def admin_users(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(User)
    count_query = select(func.count(User.id))
    if q.strip():
        term = f"%{q.strip()}%"
        user_filter = User.full_name.ilike(term) | User.email.ilike(term)
        query = query.where(user_filter)
        count_query = count_query.where(user_filter)
    users = db.scalars(query.order_by(User.created_at.desc()).offset(offset).limit(limit)).all()
    return {
        "items": [_serialize_admin_user(user, datetime.now(timezone.utc)) for user in users],
        "total": int(db.scalar(count_query) or 0),
        "limit": limit,
        "offset": offset,
        "activity_window_minutes": ACTIVE_USER_WINDOW_MINUTES,
    }


@app.get("/api/admin/login-history")
def admin_login_history(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(LoginHistory, User).join(User, User.id == LoginHistory.user_id)
    count_query = select(func.count(LoginHistory.id))
    if q.strip():
        term = f"%{q.strip()}%"
        condition = User.full_name.ilike(term) | User.email.ilike(term)
        query = query.where(condition)
        count_query = count_query.join(User, User.id == LoginHistory.user_id).where(condition)
    rows = db.execute(
        query.order_by(LoginHistory.login_at.desc()).offset(offset).limit(limit)
    ).all()
    return {
        "items": [_serialize_login_history(entry, user) for entry, user in rows],
        "total": int(db.scalar(count_query) or 0),
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/admin/analytics")
def admin_analytics(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=30)
    users = db.scalars(select(User).where(User.created_at >= cutoff)).all()
    logins = db.scalars(select(LoginHistory).where(LoginHistory.login_at >= cutoff)).all()
    registrations_by_day: dict[str, int] = {}
    logins_by_day: dict[str, int] = {}
    for user in users:
        day = as_utc(user.created_at).date().isoformat()
        registrations_by_day[day] = registrations_by_day.get(day, 0) + 1
    for record in logins:
        day = as_utc(record.login_at).date().isoformat()
        logins_by_day[day] = logins_by_day.get(day, 0) + 1
    return {
        "period_days": 30,
        "activity_window_minutes": ACTIVE_USER_WINDOW_MINUTES,
        "registrations_by_day": registrations_by_day,
        "logins_by_day": logins_by_day,
        "registrations_total": len(users),
        "logins_total": len(logins),
    }


@app.get("/api/books/search")
async def search_books(
    q: str = Query(default="", max_length=200),
    isbn: str | None = Query(default=None, max_length=20),
    genre: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=30, ge=1, le=40),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = q.strip()
    candidate_isbn = isbn or query
    normalized_isbn = re.sub(r"[^0-9Xx]", "", candidate_isbn)
    if len(normalized_isbn) not in (10, 13):
        normalized_isbn = ""
    selected_genre = (genre or "").strip()
    conditions = []
    if query:
        term = f"%{query}%"
        text_match = Book.title.ilike(term) | Book.author.ilike(term) | Book.genre.ilike(term)
        conditions.append(
            text_match | Book.isbn.ilike(f"%{normalized_isbn}%")
            if normalized_isbn else text_match
        )
    if selected_genre:
        conditions.append(Book.genre.ilike(f"%{selected_genre}%"))
    if normalized_isbn:
        conditions.append(Book.isbn.ilike(f"%{normalized_isbn}%"))
    local_books = db.scalars(
        select(Book).where(*conditions).order_by(Book.title).limit(limit)
        if conditions else select(Book).order_by(Book.title).limit(limit)
    ).all()

    if not query and not selected_genre and not normalized_isbn:
        return [serialize_book(book) for book in local_books]

    google_query = (
        f"isbn:{normalized_isbn}" if normalized_isbn else
        f"subject:{selected_genre}" if selected_genre and not query else
        f"{query} subject:{selected_genre}" if selected_genre else query
    )
    open_library_params: dict[str, str | int] = {
        "limit": min(limit, 20),
        "fields": "key,title,author_name,author_key,isbn,cover_i,first_publish_year,edition_key,edition_count,subject,first_sentence,description,publisher",
    }
    if normalized_isbn:
        open_library_params["isbn"] = normalized_isbn
    elif selected_genre and not query:
        open_library_params["subject"] = selected_genre
    elif query:
        open_library_params["q"] = query
        if selected_genre:
            open_library_params["subject"] = selected_genre

    async def google_results(client: httpx.AsyncClient) -> list[dict[str, Any]]:
        params: dict[str, str | int] = {"q": google_query, "maxResults": min(limit, 20)}
        google_key = os.getenv("GOOGLE_BOOKS_API_KEY")
        if google_key:
            params["key"] = google_key
        response = await client.get("https://www.googleapis.com/books/v1/volumes", params=params)
        response.raise_for_status()
        return [
            item for item in response.json().get("items", [])
            if isinstance(item, dict) and isinstance(item.get("volumeInfo"), dict)
        ]

    async def open_library_results(client: httpx.AsyncClient) -> list[dict[str, Any]]:
        response = await client.get("https://openlibrary.org/search.json", params=open_library_params)
        response.raise_for_status()
        docs = response.json().get("docs", [])
        return [item for item in docs if isinstance(item, dict)]

    source_results: list[dict[str, Any]] = []
    source_failures = 0
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        gathered = await asyncio.gather(
            google_results(client),
            open_library_results(client),
            return_exceptions=True,
        )
    for source_name, result in zip(("Google Books", "Open Library"), gathered):
        if isinstance(result, BaseException):
            source_failures += 1
            logger.warning("%s search failed: %s", source_name, result)
            continue
        if source_name == "Google Books":
            source_results.extend(_normalize_google_book(item) for item in result)
        else:
            source_results.extend(_normalize_open_library_book(item) for item in result)

    if source_failures == 2 and not local_books:
        raise HTTPException(status_code=502, detail="Book search providers are temporarily unavailable.")

    all_books = db.scalars(select(Book)).all()
    matched_ids = {book.id for book in local_books}
    for metadata in source_results:
        if not metadata.get("title"):
            continue
        isbn_value = metadata.get("isbn")
        normalized_title = normalized_title_for_search(metadata["title"])
        normalized_author = normalized_title_for_search(metadata.get("author", ""))
        match = next(
            (
                book for book in all_books
                if (isbn_value and book.isbn and re.sub(r"[^0-9Xx]", "", book.isbn).casefold() == isbn_value.casefold())
                or (
                    normalized_author and
                    normalized_title_for_search(book.title) == normalized_title and
                    normalized_title_for_search(book.author) == normalized_author
                )
            ),
            None,
        )
        if match:
            for field in (
                "description", "cover", "publisher", "publication_year", "isbn",
                "average_rating", "ratings_count", "editions", "retailer_name",
                "retailer_url", "price_amount", "price_currency", "price_updated_at",
            ):
                value = metadata.get(field)
                if value not in (None, "", []):
                    setattr(match, field, value)
            match.metadata_source = metadata["metadata_source"]
            matched_ids.add(match.id)
            continue

        book = Book(**metadata)
        db.add(book)
        db.flush()
        all_books.append(book)
        matched_ids.add(book.id)
    db.commit()
    found = [book for book in all_books if book.id in matched_ids]
    return [serialize_book(book) for book in sorted(found, key=lambda item: item.title.casefold())[:limit]]


def normalized_title_for_search(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _safe_google_buy_link(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname in {"books.google.com", "play.google.com"}


def _normalize_google_book(item: dict[str, Any]) -> dict[str, Any]:
    info = item.get("volumeInfo", {})
    title = str(info.get("title", "")).strip()
    authors = info.get("authors") or []
    identifiers = info.get("industryIdentifiers") or []
    isbn = next(
        (identifier.get("identifier") for kind in ("ISBN_13", "ISBN_10")
         for identifier in identifiers if identifier.get("type") == kind and identifier.get("identifier")),
        None,
    )
    published = str(info.get("publishedDate", ""))
    sale = item.get("saleInfo") or {}
    price = sale.get("listPrice") or {}
    buy_link = sale.get("buyLink")
    sale_amount = price.get("amount")
    price_is_valid = (
        sale.get("saleability") == "FOR_SALE"
        and isinstance(sale_amount, (int, float))
        and sale_amount > 0
        and _safe_google_buy_link(buy_link)
    )
    image_links = info.get("imageLinks") or {}
    cover = image_links.get("thumbnail") or image_links.get("smallThumbnail") or ""
    if cover.startswith("http://"):
        cover = "https://" + cover[7:]
    return {
        "id": f"google_{item.get('id') or uuid4().hex}",
        "title": title[:300],
        "author": ", ".join(str(author) for author in authors)[:300],
        "genre": (info.get("categories") or ["Uncategorized"])[0][:120],
        "description": str(info.get("description") or ""),
        "cover": cover,
        "publisher": str(info.get("publisher") or "")[:300],
        "publication_year": int(published[:4]) if published[:4].isdigit() else None,
        "isbn": str(isbn) if isbn else None,
        "average_rating": info.get("averageRating") if isinstance(info.get("averageRating"), (int, float)) else None,
        "ratings_count": info.get("ratingsCount") if isinstance(info.get("ratingsCount"), int) else None,
        "editions": [{
            "format": info.get("printType"),
            "page_count": info.get("pageCount"),
            "language": info.get("language"),
        }],
        "retailer_name": "Google Books" if price_is_valid else None,
        "retailer_url": buy_link if price_is_valid else None,
        "price_amount": float(sale_amount) if price_is_valid else None,
        "price_currency": price.get("currencyCode") if price_is_valid else None,
        "price_updated_at": datetime.now(timezone.utc) if price_is_valid else None,
        "metadata_source": "google_books",
    }


def _normalize_open_library_book(item: dict[str, Any]) -> dict[str, Any]:
    title = str(item.get("title") or "").strip()
    authors = item.get("author_name") or []
    isbn_values = item.get("isbn") or []
    cover_id = item.get("cover_i")
    year = item.get("first_publish_year")
    first_sentence = item.get("first_sentence") or []
    description = item.get("description") or (first_sentence[0] if first_sentence else "")
    editions = item.get("edition_key") or []
    subjects = item.get("subject") or []
    publisher = item.get("publisher") or []
    work_id = str(item.get("key") or uuid4().hex).strip("/").replace("/", "_")
    return {
        "id": f"openlibrary_{work_id}",
        "title": title[:300],
        "author": ", ".join(str(author) for author in authors)[:300],
        "genre": (subjects[0] if subjects else "Uncategorized")[:120],
        "description": str(description) if isinstance(description, str) else "",
        "cover": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else "",
        "publisher": str(publisher[0])[:300] if publisher else "",
        "publication_year": year if isinstance(year, int) else None,
        "isbn": str(isbn_values[0]) if isbn_values else None,
        "average_rating": None,
        "ratings_count": None,
        "editions": [
            {"key": edition, "edition_count": item.get("edition_count")}
            for edition in editions[:10]
        ],
        "retailer_name": None,
        "retailer_url": None,
        "price_amount": None,
        "price_currency": None,
        "price_updated_at": None,
        "metadata_source": "open_library",
    }


@app.get("/api/books/{book_id}")
def get_book(book_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return serialize_book(book)


@app.post("/api/recommendations/generate")
async def generate_recommendations(
    payload: RecommendationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    genres = set(preferences.favourite_genres if preferences else [])
    all_books = db.scalars(select(Book)).all()
    if payload.books:
        requested_books = set(payload.books)
        all_books = [book for book in all_books if book.id in requested_books]
    query_text_parts = [
        *(preferences.favourite_genres if preferences else []),
        *(preferences.favourite_authors if preferences else []),
        *(preferences.reading_categories if preferences else []),
        *(preferences.books_enjoyed_previously if preferences else []),
    ]
    history = db.scalars(select(ReadingHistory).where(ReadingHistory.user_id == user.id)).all()
    history_books = [db.get(Book, item.book_id) for item in history]
    query_text_parts.extend(
        f"{book.title} {book.author} {book.genre}"
        for book in history_books
        if book is not None
    )
    embedding_scores: dict[str, float] = {}
    if os.getenv("OPENAI_API_KEY"):
        preference_text = "Reader interests: " + (", ".join(query_text_parts) or "discovering new books")
        existing_embeddings = {
            entry.book_id: entry
            for entry in db.scalars(select(BookEmbedding)).all()
        }
        missing_books = [book for book in all_books if book.id not in existing_embeddings]
        inputs = [
            f"{book.title}. {book.author}. {book.genre}. {book.description}"
            for book in missing_books
        ]
        inputs.append(preference_text)
        vectors = await create_embeddings(inputs)
        query_embedding = vectors[-1]
        for book, vector in zip(missing_books, vectors[:-1]):
            db.add(BookEmbedding(book_id=book.id, embedding=vector))
            existing_embeddings[book.id] = BookEmbedding(book_id=book.id, embedding=vector)
        db.flush()
        if engine.dialect.name == "postgresql":
            nearest = db.execute(
                select(
                    BookEmbedding.book_id,
                    BookEmbedding.embedding.cosine_distance(query_embedding),
                ).order_by(BookEmbedding.embedding.cosine_distance(query_embedding))
            ).all()
            embedding_scores = {
                book_id: max(0.0, min(1.0, 1.0 - float(distance)))
                for book_id, distance in nearest
            }
        else:
            embedding_scores = {
                book_id: max(0.0, min(1.0, cosine_similarity(query_embedding, entry.embedding or [])))
                for book_id, entry in existing_embeddings.items()
            }

    db.execute(delete(Recommendation).where(Recommendation.user_id == user.id))
    results = []
    for book in all_books:
        overlap = book.genre in genres
        similarity = embedding_scores.get(book.id)
        score = round(60 + similarity * 38) if similarity is not None else book.match_score + (8 if overlap else 0)
        score = max(1, min(99, score))
        category = "BUY IT" if score >= 85 else "SAVE IT" if score >= 65 else "SKIP IT"
        reason = (
            f"Semantic similarity to your saved reading profile: {round(similarity * 100)}%."
            if similarity is not None
            else book.recommendation_reason or "Explore this title based on your reading profile."
        )
        recommendation = Recommendation(
            user_id=user.id,
            book_id=book.id,
            category=category,
            match_score=score,
            reason=reason,
        )
        db.add(recommendation)
        results.append({
            "book_id": book.id,
            "category": category,
            "match_score": score,
            "reason": reason,
        })
    db.commit()
    return results


@app.get("/api/recommendations")
def recommendations_list(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    entries = db.scalars(
        select(Recommendation).where(Recommendation.user_id == user.id).order_by(Recommendation.created_at.desc())
    ).all()
    return [
        {
            "id": item.id,
            "book_id": item.book_id,
            "category": item.category,
            "match_score": item.match_score,
            "reason": item.reason,
        }
        for item in entries
    ]


@app.post("/api/assistant/ask")
async def ask_book_assistant(
    payload: AssistantQuestion,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="The AI book assistant is not configured on this server.")
    candidates = db.scalars(select(Book).order_by(Book.title).limit(100)).all()
    if not candidates:
        return {"message": "The book catalogue is empty, so I cannot recommend a title yet.", "books": []}

    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    history_entries = db.scalars(
        select(ReadingHistory).where(ReadingHistory.user_id == user.id).order_by(ReadingHistory.updated_at.desc()).limit(20)
    ).all()
    history_books = [
        db.get(Book, entry.book_id)
        for entry in history_entries
    ]
    profile = {
        "favourite_genres": preferences.favourite_genres if preferences else [],
        "favourite_authors": preferences.favourite_authors if preferences else [],
        "reading_categories": preferences.reading_categories if preferences else [],
        "recently_saved_books": [
            {"title": book.title, "author": book.author, "genre": book.genre}
            for book in history_books if book is not None
        ],
    }
    catalogue = [
        {
            "id": book.id,
            "title": book.title,
            "author": book.author,
            "genre": book.genre,
            "description": book.description[:700],
        }
        for book in candidates
    ]
    request_payload = {
        "model": os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are Shelf Scan's book assistant. Use only the supplied catalogue and reader profile. "
                    "Never invent books, authors, plot facts, prices, or retailer availability. "
                    "Return JSON with a concise helpful 'message' and 'book_ids' containing at most three exact IDs "
                    "from the catalogue. If no titles fit, return an empty book_ids list."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "question": payload.question,
                    "reader_profile": profile,
                    "catalogue": catalogue,
                }),
            },
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_payload,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
        logger.exception("AI book assistant request failed")
        raise HTTPException(status_code=502, detail="The AI book assistant is temporarily unavailable.") from exc

    try:
        assistant_result = json.loads(content)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The AI book assistant returned invalid data.") from exc
    if (
        not isinstance(assistant_result, dict)
        or not isinstance(assistant_result.get("message"), str)
        or not assistant_result["message"].strip()
        or not isinstance(assistant_result.get("book_ids"), list)
    ):
        raise HTTPException(status_code=502, detail="The AI book assistant returned invalid data.")
    candidate_by_id = {book.id: book for book in candidates}
    book_ids = assistant_result["book_ids"]
    if (
        len(book_ids) > 3
        or any(not isinstance(book_id, str) or book_id not in candidate_by_id for book_id in book_ids)
    ):
        raise HTTPException(status_code=502, detail="The AI book assistant returned invalid book references.")
    return {
        "message": assistant_result["message"].strip(),
        "books": [serialize_book(candidate_by_id[book_id]) for book_id in dict.fromkeys(book_ids)],
    }


@app.get("/api/library")
def get_library(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    entries = db.execute(
        select(UserLibrary, Book).join(Book, Book.id == UserLibrary.book_id).where(UserLibrary.user_id == user.id)
    ).all()
    return [{**serialize_book(book), "status": entry.status} for entry, book in entries]


@app.post("/api/library/save")
def save_book(
    payload: LibrarySavePayload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if payload.status not in {"favourite", "want_to_read", "currently_reading", "completed"}:
        raise HTTPException(status_code=422, detail="Unsupported library status.")
    if not db.get(Book, payload.book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    existing = db.scalar(
        select(UserLibrary).where(UserLibrary.user_id == user.id, UserLibrary.book_id == payload.book_id)
    )
    if existing:
        existing.status = payload.status
    else:
        db.add(UserLibrary(user_id=user.id, book_id=payload.book_id, status=payload.status))
    db.add(ReadingHistory(user_id=user.id, book_id=payload.book_id, status=payload.status))
    db.commit()
    return {"book_id": payload.book_id, "status": payload.status}


@app.delete("/api/library/{book_id}")
def remove_book(book_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    entry = db.scalar(select(UserLibrary).where(UserLibrary.user_id == user.id, UserLibrary.book_id == book_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Book not found in library")
    db.delete(entry)
    db.commit()
    return {"status": "removed"}


@app.get("/api/favourites")
def get_favourites(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    entries = db.execute(
        select(Book).join(FavouriteBook, FavouriteBook.book_id == Book.id).where(FavouriteBook.user_id == user.id)
    ).scalars().all()
    return [serialize_book(book) for book in entries]


@app.post("/api/favourites/{book_id}")
def add_favourite(book_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    if not db.get(Book, book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    existing = db.scalar(
        select(FavouriteBook).where(FavouriteBook.user_id == user.id, FavouriteBook.book_id == book_id)
    )
    if not existing:
        db.add(FavouriteBook(user_id=user.id, book_id=book_id))
        db.commit()
    return {"book_id": book_id, "status": "favourite"}


@app.delete("/api/favourites/{book_id}")
def remove_favourite(book_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    entry = db.scalar(
        select(FavouriteBook).where(FavouriteBook.user_id == user.id, FavouriteBook.book_id == book_id)
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Book not found in favourites")
    db.delete(entry)
    db.commit()
    return {"status": "removed"}


def serialize_cart(user: User, db: Session) -> dict[str, Any]:
    rows = db.execute(
        select(CartItem, Book)
        .join(Book, Book.id == CartItem.book_id)
        .where(CartItem.user_id == user.id)
        .order_by(CartItem.added_at)
    ).all()
    items = []
    prices_available = True
    currencies: set[str] = set()
    subtotal = 0.0
    for item, book in rows:
        serialized = serialize_book(book)
        line_total = None
        if serialized["price_amount"] is None or serialized["price_currency"] is None:
            prices_available = False
        else:
            currencies.add(serialized["price_currency"])
            line_total = round(serialized["price_amount"] * item.quantity, 2)
            subtotal += line_total
        items.append({
            "quantity": item.quantity,
            "added_at": item.added_at.isoformat(),
            "line_total": line_total,
            "book": serialized,
        })
    if len(currencies) > 1:
        prices_available = False
    return {
        "items": items,
        "subtotal": round(subtotal, 2) if prices_available else None,
        "total": None,
        "currency": next(iter(currencies)) if len(currencies) == 1 else None,
        "prices_available": prices_available,
        "price_unavailable_count": sum(1 for item in items if item["line_total"] is None),
        "purchase_note": "Purchases are completed with the listed retailer; Shelf Scan does not process this order.",
    }


@app.get("/api/cart")
def get_cart(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    return serialize_cart(user, db)


@app.post("/api/cart")
def add_cart_item(
    payload: CartItemPayload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not db.get(Book, payload.book_id):
        raise HTTPException(status_code=404, detail="Book not found in the catalogue.")
    entry = db.scalar(
        select(CartItem).where(CartItem.user_id == user.id, CartItem.book_id == payload.book_id)
    )
    if entry:
        entry.quantity = min(99, entry.quantity + payload.quantity)
    else:
        db.add(CartItem(user_id=user.id, book_id=payload.book_id, quantity=payload.quantity))
    db.commit()
    return serialize_cart(user, db)


@app.patch("/api/cart/{book_id}")
def update_cart_item(
    book_id: str,
    payload: CartQuantityPayload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    entry = db.scalar(
        select(CartItem).where(CartItem.user_id == user.id, CartItem.book_id == book_id)
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Book not found in your cart.")
    entry.quantity = payload.quantity
    db.commit()
    return serialize_cart(user, db)


@app.delete("/api/cart/{book_id}")
def remove_cart_item(
    book_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    entry = db.scalar(
        select(CartItem).where(CartItem.user_id == user.id, CartItem.book_id == book_id)
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Book not found in your cart.")
    db.delete(entry)
    db.commit()
    return serialize_cart(user, db)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
