import os
from datetime import datetime, timedelta
import jwt
from fastapi import Depends, HTTPException, status
import hashlib
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import SessionLocal, Usuario

# Configuración de Seguridad
SECRET_KEY = os.environ.get("JWT_SECRET", "super-secret-key-cineverse-rad")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 días de duración

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        salt_hex, hash_hex = hashed_password.split(":")
        salt = bytes.fromhex(salt_hex)
        db_password = hashlib.pbkdf2_hmac(
            'sha256',
            plain_password.encode('utf-8'),
            salt,
            100000
        )
        return db_password.hex() == hash_hex
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = os.urandom(16)
    db_password = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt,
        100000
    )
    return salt.hex() + ":" + db_password.hex()

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales de acceso no válidas.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    print(f"[AUTH_DEBUG] Received token: {token}")
    if not token:
        print("[AUTH_DEBUG] No token provided")
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        print(f"[AUTH_DEBUG] Decoded payload: {payload}")
        user_id_raw = payload.get("sub")
        if user_id_raw is None:
            print("[AUTH_DEBUG] sub not in payload")
            raise credentials_exception
        try:
            user_id = int(user_id_raw)
        except ValueError:
            print(f"[AUTH_DEBUG] sub is not a valid integer: {user_id_raw}")
            raise credentials_exception
    except jwt.PyJWTError as e:
        print(f"[AUTH_DEBUG] JWT decode error: {e}")
        raise credentials_exception
        
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if user is None:
        print(f"[AUTH_DEBUG] User with ID {user_id} not found in DB")
        raise credentials_exception
    print(f"[AUTH_DEBUG] Authenticated user: {user.email}")
    return user
