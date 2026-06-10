import imaplib
import email
from email.utils import parsedate_to_datetime
import os
import re
import pdfplumber
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from googleapiclient.discovery import build
from google.cloud import firestore
from google.oauth2 import service_account
import json
from datetime import datetime
import functions_framework

# --- KONFIGURÁCIÓ ---
GMAIL_EMAIL = "markigergely1@gmail.com"
GMAIL_APP_PASSWORD = "ngozldarnlequeuk" # Ideiglenes jelszó
EMAIL_FELADO = "korsoandi@szmg.hu" 

CREDENTIALS_FILE = 'credentials.json'    
GSHEET_NAME = 'Attendance'                
GSHEET_TAB_NAME = 'Szamlak'               

FIRESTORE_INVOICES = "invoices"

# --- FÜGGVÉNYEK ---

def kinyeri_az_osszeget(pdf_path):
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text = "".join(page.extract_text() for page in pdf.pages)
            match = re.search(r"(Végösszeg|Fizetendő|Összesen)\s*:?\s*([\d\s\.]+)\s*(Ft|HUF)", text, re.IGNORECASE)
            if match:
                return int(match.group(2).replace(" ", "").replace("\xa0", "").replace(".", ""))
            alt_matches = re.findall(r"(?<!\d)([\d\s\.]+)\s*(Ft|HUF)", text, re.IGNORECASE)
            if alt_matches:
                return int(alt_matches[-1][0].replace(" ", "").replace("\xa0", "").replace(".", ""))
    except Exception as e:
        print(f"Hiba a PDF olvasásakor: {e}")
        return None

@functions_framework.http
def process_emails(request):
    """Fő folyamat, amit a Cloud Scheduler meghív."""
    print(f"A felhős email feldolgozó elindult: {datetime.now()}")
    new_data_count = 0

    # 1. Google Sheets Kapcsolat
    try:
        scope = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
        creds = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_FILE, scope)
        client = gspread.authorize(creds)
        sheet = client.open(GSHEET_NAME).worksheet(GSHEET_TAB_NAME)
    except Exception as e:
        print(f"Hiba a Google Sheets inicializálásakor: {e}")
        return "Sheet Error", 500

    # 2. Firestore Kapcsolat és Duplikációk lekérése
    existing_invoice_keys = set()
    try:
        with open(CREDENTIALS_FILE, 'r') as f:
            creds_dict = json.load(f)
        fs_creds = service_account.Credentials.from_service_account_info(creds_dict)
        db = firestore.Client(credentials=fs_creds, project=creds_dict.get("project_id"))
        
        # Lekérjük az eddigi számlákat, hogy ne mentsük el őket kétszer
        docs = db.collection(FIRESTORE_INVOICES).stream()
        for doc in docs:
            d = doc.to_dict()
            # Egyedi kulcs készítése: ÉV_HÓNAP_ÖSSZEG (pl. 2026_2_16000.0)
            key = f"{d.get('target_year')}_{d.get('target_month')}_{float(d.get('amount', 0))}"
            existing_invoice_keys.add(key)
    except Exception as e:
        print(f"Hiba a Firestore inicializálásakor: {e}")
        db = None

    # 3. Gmail Kapcsolat
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(GMAIL_EMAIL, GMAIL_APP_PASSWORD)
        mail.select("inbox")
    except Exception as e:
        print(f"Hiba a Gmail bejelentkezéskor: {e}")
        return "Gmail Error", 500

    # Keresés: Minden (olvasott és olvasatlan) email 2026. Febr. 28. óta
    status, data = mail.search(None, '(FROM "korsoandi@szmg.hu" SINCE 28-Feb-2026)')
    ids = data[0].split()

    if not ids:
        msg = f"Nincs új feldolgozandó email. ({datetime.now()})"
        print(msg)
        return msg, 200

    print(f"{len(ids)} email átvizsgálása...")

    for num in ids:
        try:
            _, msg_data = mail.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(msg_data[0][1])
            
            # Email valódi dátumának kinyerése
            try:
                email_date = parsedate_to_datetime(msg.get("Date"))
                inv_date = email_date.date()
            except:
                inv_date = datetime.now().date()
            
            for part in msg.walk():
                if part.get_content_type() == "application/pdf":
                    fname = part.get_filename() or f"szamla_{num.decode()}.pdf"
                    
                    path = os.path.join('/tmp', fname)
                    with open(path, "wb") as f: 
                        f.write(part.get_payload(decode=True))
                    
                    amount = kinyeri_az_osszeget(path)
                    
                    if amount:
                        # Hónap és év számítása az email megérkezésének dátumából (előző hónap a cél)
                        if inv_date.month == 1:
                            t_month = 12
                            t_year = inv_date.year - 1
                        else:
                            t_month = inv_date.month - 1
                            t_year = inv_date.year
                            
                        # --- DUPLIKÁCIÓ ELLENŐRZÉSE ---
                        current_key = f"{t_year}_{t_month}_{float(amount)}"
                        if current_key in existing_invoice_keys:
                            print(f"Már létező számla ({t_year}. {t_month} hó, {amount} Ft), kihagyás...")
                            if os.path.exists(path): os.remove(path)
                            continue # Ugrunk a következőre, ezt nem mentjük el újra!
                        
                        # --- MENTÉS GOOGLE SHEETS-BE ---
                        date_str = email_date.strftime("%Y-%m-%d %H:%M")
                        try:
                            sheet.append_row([date_str, amount, fname])
                            print(f"+ Rögzítve a Sheet-be: {amount} Ft")
                        except Exception as e:
                            print(f"Hiba a Sheet mentésnél: {e}")

                        # --- MENTÉS FIRESTORE-BA ---
                        if db:
                            try:
                                db.collection(FIRESTORE_INVOICES).add({
                                    "inv_date": inv_date.strftime("%Y-%m-%d"),
                                    "target_year": t_year,
                                    "target_month": t_month,
                                    "amount": float(amount),
                                    "filename": fname
                                })
                                print(f"+ Rögzítve a Firestore-ba is: {t_year}. {t_month}. hóhoz")
                                # Hozzáadjuk a listához, hogy a futás alatt se duplikáljuk
                                existing_invoice_keys.add(current_key)
                            except Exception as e:
                                print(f"Hiba a Firestore mentésnél: {e}")

                        new_data_count += 1
                        print(f"Sikeres feldolgozás: {fname}")
                    
                    # Töröljük az átmeneti PDF-et
                    if os.path.exists(path):
                        os.remove(path)
                    break
            
        except Exception as e:
             print(f"Hiba az email feldolgozása közben: {e}")

    mail.logout()
    return f"Feldolgozás kész. {new_data_count} új számla rögzítve.", 200