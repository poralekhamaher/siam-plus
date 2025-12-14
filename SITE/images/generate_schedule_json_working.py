import csv
import sys
import time
import re
import json
import os
import tempfile
import shutil
from dataclasses import dataclass
from typing import List, Optional

from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager


DEFAULT_BASE_URL = "http://home.sis.siam.edu"


@dataclass
class Credentials:
    username: str
    password: str


class AxiomFlowToPython:
    """
    Replicates the Axiom automation defined in axiom_new_automation.json using Selenium.

    Steps covered (mapped from the JSON):
    - Open http://home.sis.siam.edu
    - Click English language flag
    - Click => Login
    - Enter username (f_uid)
    - Enter password (f_pwd)
    - Click LOGIN submit
    - Click the dynamic "Go Back" link (anchor containing img src *goback_1.gif)
    - Click the "Time table" menu (img src *time_table_1.gif)
    - Scrape the timetable table and save to CSV
    """

    def __init__(self, creds: Credentials, headless: bool = False, base_url: str = DEFAULT_BASE_URL):
        self.creds = creds
        self.base_url = base_url
        self.driver: Optional[webdriver.Chrome] = None
        self.wait: Optional[WebDriverWait] = None
        self.headless = headless
        self._profile_dir: Optional[str] = None

    # -------- Browser setup --------
    def start(self) -> None:
        options = webdriver.ChromeOptions()
        # Use a fresh profile to avoid stale autofill or saved credentials.
        self._profile_dir = tempfile.mkdtemp(prefix="siam_chrome_profile_")
        options.add_argument(f"--user-data-dir={self._profile_dir}")
        options.add_argument("--incognito")
        options.add_experimental_option(
            "prefs",
            {
                "credentials_enable_service": False,
                "profile.password_manager_enabled": False,
            },
        )
        if self.headless:
            options.add_argument("--headless=new")
        options.add_argument("--ignore-certificate-errors")
        options.add_argument("--ignore-ssl-errors")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--disable-notifications")
        options.add_experimental_option("detach", True)

        service = ChromeService(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=options)
        self.driver.maximize_window()
        self.driver.set_page_load_timeout(45)
        self.wait = WebDriverWait(self.driver, 20)

    def stop(self) -> None:
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
        if self._profile_dir and os.path.isdir(self._profile_dir):
            try:
                shutil.rmtree(self._profile_dir, ignore_errors=True)
            except Exception:
                pass

    # -------- Helpers --------
    def _safe_click(self, by: By, selector: str, desc: str = "element") -> bool:
        try:
            el = self.wait.until(EC.element_to_be_clickable((by, selector)))
            try:
                el.click()
            except Exception:
                # fallback to JS click if normal click fails (overlays, etc.)
                self.driver.execute_script("arguments[0].click();", el)
            return True
        except TimeoutException:
            print(f"Timed out waiting for {desc}")
            return False

    def _type(self, by: By, selector: str, text: str, desc: str) -> bool:
        try:
            el = self.wait.until(EC.presence_of_element_located((by, selector)))
            el.clear()
            el.send_keys(text)
            return True
        except TimeoutException:
            print(f"Timed out waiting for field: {desc}")
            return False

    # -------- Flow steps --------
    def open_home(self) -> None:
        assert self.driver is not None
        print("Navigating to homepage…")
        self.driver.get(self.base_url)

    def click_english_flag(self) -> None:
        # Primary: CSS path from Axiom
        css = "td > div > table > tbody > tr > td > table > tbody > tr > td:nth-last-of-type(1) > a > img"
        print("Switching to English (trying primary selector)…")
        if self._safe_click(By.CSS_SELECTOR, css, "English flag"):
            time.sleep(1.2)
            return
        print("Primary selector failed; trying by image src contains 'usa_en.jpeg'…")
        self._safe_click(By.XPATH, "//img[contains(@src,'usa_en.jpeg')]/ancestor::a[1]", "English flag (fallback)")
        time.sleep(1.0)

    def click_login_link(self) -> bool:
        print("Clicking => Login…")
        if self._safe_click(By.CSS_SELECTOR, "tr:nth-of-type(4) > td:nth-of-type(1) > a:nth-of-type(1)", "=> Login"):
            return True
        # Fallback by href/text
        return self._safe_click(By.XPATH, "//a[contains(@href,'registrar/login.asp') or contains(normalize-space(.),'Login')]", "=> Login (fallback)")

    def fill_credentials_and_submit(self) -> bool:
        print("Filling credentials…")
        uid_ok = self._type(By.NAME, "f_uid", self.creds.username, "username f_uid")
        pwd_ok = self._type(By.NAME, "f_pwd", self.creds.password, "password f_pwd")
        if not (uid_ok and pwd_ok):
            return False
        print("Submitting login…")
        # Prefer the exact submit used in Axiom
        if self._safe_click(By.XPATH, "//input[@type='SUBMIT']", "LOGIN submit"):
            return True
        return self._safe_click(By.XPATH, "//input[@type='submit']", "LOGIN submit (fallback)")

    def click_go_back(self) -> bool:
        """
        Click the "Go Back" anchor that contains the goback_1.gif image.
        The href has a dynamic avsXXXXXXXX param on each login; we target the element by image.
        """
        print("Clicking dynamic Go Back button…")
        # Be generous with waits here as the portal may redirect after login
        try:
            el = self.wait.until(
                EC.element_to_be_clickable((By.XPATH, "//img[contains(@src,'goback_1.gif')]/ancestor::a[1]"))
            )
            try:
                el.click()
            except Exception:
                self.driver.execute_script("arguments[0].click();", el)
            time.sleep(1.0)
            return True
        except TimeoutException:
            print("Could not find the Go Back button (goback_1.gif)")
            return False

    def click_time_table(self) -> bool:
        print("Opening Timetable…")
        return self._safe_click(By.XPATH, "//img[contains(@src,'time_table_1.gif')]/ancestor::a[1]", "Time table link")

    # -------- Scraping --------
    def _extract_largest_table(self) -> List[List[str]]:
        """Heuristic: grab the largest visible table's text as a 2D list."""
        assert self.driver is not None
        tables = self.driver.find_elements(By.TAG_NAME, "table")
        max_cells = 0
        best: Optional[webdriver.remote.webelement.WebElement] = None
        for t in tables:
            try:
                rows = t.find_elements(By.TAG_NAME, "tr")
                cells = sum(len(r.find_elements(By.XPATH, "./th|./td")) for r in rows)
                if cells > max_cells:
                    max_cells = cells
                    best = t
            except Exception:
                continue

        result: List[List[str]] = []
        if not best:
            return result
        for r in best.find_elements(By.TAG_NAME, "tr"):
            row: List[str] = []
            for c in r.find_elements(By.XPATH, "./th|./td"):
                try:
                    row.append(c.text.strip())
                except Exception:
                    row.append("")
            if any(cell for cell in row):
                result.append(row)
        return result

    def scrape_timetable(self) -> List[List[str]]:
        print("Scraping timetable table (raw)…")
        # Kept for reference/debug; not used for final CSV now
        time.sleep(0.8)
        return self._extract_largest_table()

    def scrape_timetable_structured(self) -> List[List[str]]:
        """
        Produce a clean, daily schedule with columns:
        [day, location, course_name, start_time, end_time, course_code]

        - Derives start/end from cell colspans (5-min slots) starting 09:00.
        - Extracts course name from the anchor title; code from anchor text.
        - Formats location as "Building X Room YYY" from text like "2-202" or "2-308-9".
        """
        assert self.driver is not None
        print("Scraping timetable table (structured)…")
        time.sleep(0.8)

        def find_timetable_table():
            tables = self.driver.find_elements(By.TAG_NAME, "table")
            for tb in tables:
                try:
                    trs = tb.find_elements(By.TAG_NAME, "tr")
                    if len(trs) < 3:
                        continue
                    header_txt = " ".join(trs[1].text.split()).upper()
                    if "DAY/TIME" in header_txt and "9:00-10:00" in header_txt:
                        return tb
                except Exception:
                    continue
            return None

        tb = find_timetable_table()
        if not tb:
            print("Timetable grid not found; returning empty.")
            return []

        # Build output
        out: List[List[str]] = [["day", "location", "course_name", "start_time", "end_time", "course_code"]]

        # Time helpers
        base_hour = 9  # grid starts at 09:00
        minutes_per_slot = 5

        def slot_to_hhmm(slot_idx: int) -> str:
            total_minutes = base_hour * 60 + slot_idx * minutes_per_slot
            hh = total_minutes // 60
            mm = total_minutes % 60
            return f"{hh:02d}:{mm:02d}"

        # Parse rows for each day
        day_names = {"MON": "Mon", "TUE": "Tue", "WED": "Wed", "THU": "Thu", "FRI": "Fri", "SAT": "Sat", "SUN": "Sun"}

        rows = tb.find_elements(By.TAG_NAME, "tr")
        for tr in rows:
            tds = tr.find_elements(By.TAG_NAME, "td")
            if not tds:
                continue
            # Identify day cell (first td often with day label)
            day_cell_text = (tds[0].text or "").strip().upper()
            day_key = None
            for key in day_names.keys():
                if key in day_cell_text:
                    day_key = key
                    break
            if not day_key:
                continue

            day_label = day_names[day_key]

            # current slot index from 09:00; skip the first day label cell by subtracting its colspan
            current_slot = 0

            # Iterate over cells after the day label cell
            for td in tds[1:]:
                # Determine colspan (slots)
                colsp_attr = td.get_attribute("colspan") or "1"
                try:
                    span = int(colsp_attr)
                except Exception:
                    span = 1

                # A class block typically has a link with the course code and colored background
                anchors = td.find_elements(By.TAG_NAME, "a")
                if anchors:
                    a = anchors[0]
                    course_code = (a.text or "").strip()
                    course_name = a.get_attribute("title") or ""
                    cell_text = td.text or ""

                    # Lines inside the cell often are:
                    #   <code> (from link)
                    #   (x) y, B-ROOM or B-ROOM-ROOM
                    #   B   (building number again on its own line)
                    lines = [ln.strip() for ln in cell_text.splitlines() if ln.strip()]

                    # Building: prefer last non-empty line numeric
                    building = ""
                    if lines:
                        nums = re.findall(r"\d+", lines[-1])
                        if nums:
                            building = nums[-1]

                    # Find a hyphen group in the cell that is NOT the course code
                    hyphen_groups = re.findall(r"\b\d+-\d+(?:-\d+)?\b", cell_text)
                    hyphen_groups = [g for g in hyphen_groups if _normalize_code(g) != _normalize_code(course_code)]

                    rooms_display = ""
                    if hyphen_groups:
                        candidate = hyphen_groups[0]
                        # Remove building prefix if present
                        if building and candidate.startswith(f"{building}-"):
                            rooms_str = candidate[len(building) + 1 :]
                        else:
                            parts = candidate.split("-", 1)
                            rooms_str = parts[1] if len(parts) > 1 else candidate

                        # Expand shorthand like 308-9 -> 308, 309
                        room_parts = rooms_str.split("-") if rooms_str else []
                        if room_parts:
                            base = room_parts[0]
                            rooms: list[str] = [base]
                            for p in room_parts[1:]:
                                if len(p) < len(base):
                                    rooms.append(base[: len(base) - len(p)] + p)
                                else:
                                    rooms.append(p)
                            # Deduplicate preserving order
                            seen = set()
                            ordered = []
                            for r in rooms:
                                if r not in seen:
                                    seen.add(r)
                                    ordered.append(r)
                            rooms_display = ", ".join(ordered)

                    if building and rooms_display:
                        location = f"Building {building} Room {rooms_display}"
                    elif building:
                        location = f"Building {building}"
                    elif rooms_display:
                        location = f"Room {rooms_display}"
                    else:
                        location = ""

                    start_time = slot_to_hhmm(current_slot)
                    end_time = slot_to_hhmm(current_slot + span)

                    out.append([day_label, location, course_name, start_time, end_time, course_code])

                # advance slots by the colspan regardless
                current_slot += span

        return out

    def scrape_exam_table(self) -> List[List[str]]:
        """Scrape the EXAM TIMETABLE grid into rows with headers.
        Columns: [coursecode, coursename, group, midterm, finals, seat]
        """
        assert self.driver is not None
        print("Scraping exam timetable…")
        time.sleep(0.5)

        tables = self.driver.find_elements(By.TAG_NAME, "table")
        for tb in tables:
            try:
                trs = tb.find_elements(By.TAG_NAME, "tr")
                if not trs:
                    continue
                header = " ".join(trs[0].text.split()).upper()
                # Look for header keywords in any of the first two rows
                if not ("COURSECODE" in header and "COURSENAME" in header and "GROUP" in header and "MIDTERM" in header and "FINALS" in header and "SEAT" in header):
                    if len(trs) > 1:
                        header2 = " ".join(trs[1].text.split()).upper()
                        if not ("COURSECODE" in header2 and "COURSENAME" in header2 and "GROUP" in header2 and "MIDTERM" in header2 and "FINALS" in header2 and "SEAT" in header2):
                            continue
                # Found the exam table; extract rows after the header
                rows_out: List[List[str]] = [["coursecode", "coursename", "group", "midterm", "finals", "seat"]]
                for tr in trs[1:]:
                    tds = tr.find_elements(By.TAG_NAME, "td")
                    if len(tds) < 6:
                        continue
                    vals = [td.text.strip().replace("\xa0", " ") for td in tds[:6]]
                    # Normalize course code cell (remove surrounding spaces)
                    vals[0] = vals[0].replace(" ", "")
                    rows_out.append(vals)
                return rows_out
            except Exception:
                continue

        print("Exam timetable not found.")
        return []

    # -------- Grades navigation --------
    def navigate_back_to_menu(self) -> None:
        """Try to return to the main student menu using on-page back button, else history.back."""
        print("Returning to previous page…")
        # Try back button by image (same as earlier pattern)
        if not self._safe_click(By.XPATH, "//img[contains(@src,'goback_1.gif')]/ancestor::a[1]", "Go Back"):
            try:
                self.driver.back()
                time.sleep(0.8)
            except Exception:
                pass

    def click_grade_results(self) -> bool:
        print("Opening Grade Results…")
        # Use the image-based selector to avoid dynamic avs param
        if self._safe_click(By.XPATH, "//img[contains(@src,'grade_1.gif')]/ancestor::a[1]", "Grade results"):
            return True
        # Fallback: any link to grade.asp
        return self._safe_click(By.XPATH, "//a[contains(@href,'grade.asp')]", "Grade results (fallback)")

    # -------- Grades scraping --------
    def scrape_grades(self) -> List[List[str]]:
        """
        Scrape all course rows from the grade results page.
        Output columns: [section, coursecode, coursename, credit, grade]
        Sections include 'TRANSFER COURSE' and 'SEMESTER X/YYYY'.
        """
        print("Scraping grades…")
        time.sleep(1.0)
        assert self.driver is not None

        rows_out: List[List[str]] = [["section", "coursecode", "coursename", "credit", "grade"]]

        # Find all tables that contain the header labels COURSECODE/COURSENAME
        tables = self.driver.find_elements(By.TAG_NAME, "table")
        for t in tables:
            try:
                trs = t.find_elements(By.TAG_NAME, "tr")
                if not trs:
                    continue

                # Identify if this table is a grade table by header presence
                header_found = False
                section_label = ""
                start_idx = 0
                for idx, tr in enumerate(trs):
                    txt = tr.text.strip().upper()
                    if not txt:
                        continue
                    # Section row often has bold title and colspan=4
                    if ("TRANSFER COURSE" in txt) or ("SEMESTER" in txt):
                        section_label = tr.text.strip()
                        continue
                    # Header row with column labels
                    if ("COURSECODE" in txt) and ("COURSENAME" in txt) and ("CREDIT" in txt) and ("GRADE" in txt):
                        header_found = True
                        start_idx = idx + 1
                        break

                if not header_found:
                    continue

                # Collect subsequent data rows until a row that looks like a new section/header or empty
                for tr in trs[start_idx:]:
                    tds = tr.find_elements(By.XPATH, "./td")
                    if len(tds) < 4:
                        # Possibly reached end of this table's data region
                        continue
                    # If this row looks like a new header/section, stop
                    text_up = tr.text.strip().upper()
                    if ("COURSECODE" in text_up and "COURSENAME" in text_up) or ("SEMESTER" in text_up) or ("TRANSFER COURSE" in text_up):
                        break

                    # Extract the four columns
                    code = tds[0].text.strip().lstrip("\xa0 ")
                    name = tds[1].text.strip()
                    credit = tds[2].text.strip()
                    grade = tds[3].text.strip().lstrip("\xa0 ")

                    # Skip empty lines
                    if not (code or name or credit or grade):
                        continue

                    rows_out.append([section_label, code, name, credit, grade])
            except Exception:
                continue

        return rows_out

    # -------- Orchestration --------
    def run(self) -> tuple[List[List[str]], List[List[str]]]:
        self.start()
        try:
            self.open_home()
            # Language toggle is optional; try it but continue even if it fails
            try:
                self.click_english_flag()
            except Exception:
                pass

            if not self.click_login_link():
                raise RuntimeError("Could not click login link")

            if not self.fill_credentials_and_submit():
                raise RuntimeError("Could not submit login form")

            # After login, click the dynamic Go Back button
            if not self.click_go_back():
                print("Warning: Go Back button not clicked. Flow may still work if already on student page.")

            # Open timetable
            if not self.click_time_table():
                raise RuntimeError("Could not open timetable page")

            # Scrape structured timetable
            timetable = self.scrape_timetable_structured()

            # Navigate back to the menu, open Grade Results, and scrape
            self.navigate_back_to_menu()
            if not self.click_grade_results():
                raise RuntimeError("Could not open grade results page")
            grades = self.scrape_grades()

            return timetable, grades
        finally:
            # Keep the browser open a moment for visibility, then close
            time.sleep(1.0)
            self.stop()


def save_csv(rows: List[List[str]], path: str) -> None:
    if not rows:
        print("No rows scraped; skipping CSV write.")
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for r in rows:
            writer.writerow(r)
    print(f"Saved CSV to {path}")


def _normalize_code(code: str) -> str:
    return (code or "").upper().replace(" ", "").strip()


def _dedupe_grades(grades: List[List[str]]) -> List[List[str]]:
    """Deduplicate grades by course code and sanitize credit values."""
    if not grades:
        return []

    header = grades[0]
    out: List[List[str]] = [header]
    seen = set()

    for row in grades[1:]:
        if len(row) < 5:
            continue
        code_raw = row[1].strip()
        code_norm = _normalize_code(code_raw)
        if not code_norm or code_norm in seen:
            continue
        seen.add(code_norm)

        credit_raw = row[3].strip()
        credit_digits = re.findall(r"\d+(?:\.\d+)?", credit_raw)
        credit_clean = credit_digits[0] if credit_digits else credit_raw

        out.append([
            row[0],
            code_raw,
            row[2],
            credit_clean,
            row[4],
        ])

    return out
650
def merge_timetable_and_exams(timetable: List[List[str]], exams: List[List[str]]) -> List[List[str]]:
    """
    Merge structured timetable rows with exam timetable by course code.
    Output columns:
    [day, location, start_time, end_time, course_code, timetable_course_name, exam_course_name, group, midterm, finals, seat]
    """
    if not timetable:
        return []

    # Build lookup from exams by course code
    exam_lookup = {}
    if exams and len(exams) > 1:
        # Expect header at exams[0]
        for row in exams[1:]:
            if len(row) < 6:
                continue
            code = _normalize_code(row[0])
            # exam coursename may contain English + Thai split by newline
            exam_name = (row[1] or "").split("\n")[0].strip()
            exam_lookup[code] = {
                "exam_course_name": exam_name,
                "group": row[2] if len(row) > 2 else "",
                "midterm": row[3] if len(row) > 3 else "",
                "finals": row[4] if len(row) > 4 else "",
                "seat": row[5] if len(row) > 5 else "",
            }

    merged: List[List[str]] = [[
        "day",
        "location",
        "start_time",
        "end_time",
        "course_code",
        "timetable_course_name",
        "exam_course_name",
        "group",
        "midterm",
        "finals",
        "seat",
    ]]

    # Timetable header expected as:
    # [day, location, course_name, start_time, end_time, course_code]
    for row in timetable[1:] if len(timetable) > 1 else []:
        if len(row) < 6:
            continue
        day = row[0]
        location = row[1]
        tt_name = row[2]
        start_time = row[3]
        end_time = row[4]
        code = row[5]
        key = _normalize_code(code)
        ex = exam_lookup.get(key, {})
        merged.append([
            day,
            location,
            start_time,
            end_time,
            code,
            tt_name,
            ex.get("exam_course_name", ""),
            ex.get("group", ""),
            ex.get("midterm", ""),
            ex.get("finals", ""),
            ex.get("seat", ""),
        ])

    return merged


def get_schedule_json(username: str, password: str, headless: bool = True) -> dict:
    """
    Programmatic API to get schedule and grades as JSON-friendly dict.

    Returns:
      { "timetable": [ {day, location, course_name, start_time, end_time, course_code}, ... ],
        "grades":    [ {section, coursecode, coursename, credit, grade}, ... ] }
    """
    creds = Credentials(username=username, password=password)
    flow = AxiomFlowToPython(creds=creds, headless=headless)
    timetable, grades = flow.run()
    grades = _dedupe_grades(grades)

    def _rows_to_dicts(rows: list[list[str]]) -> list[dict]:
        if not rows:
            return []
        headers = rows[0]
        out = []
        for r in rows[1:]:
            row = list(r) + [""] * (len(headers) - len(r))
            row = row[: len(headers)]
            out.append({headers[i]: row[i] for i in range(len(headers))})
        return out

    return {"timetable": _rows_to_dicts(timetable), "grades": _rows_to_dicts(grades)}


def save_json(data: dict, path: str) -> None:
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def run_scraper(student_id: str, password: str) -> None:
    """
    Run the scraper using provided credentials and save schedule_{student_id}.json next to this script.
    """
    data = get_schedule_json(student_id, password, headless=True)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(script_dir, f"schedule_{student_id}.json")
    save_json(data, out_path)
    print(f"Saved JSON to {out_path}")


if __name__ == "__main__":
    # Simple CLI:
    #   python generate_schedule_json_working.py [username] [password] [--headless] [--json]
    # Default behavior: saves JSON to schedule_{username}.json next to this script
    args = sys.argv[1:]
    headless = "--headless" in args
    json_out = "--json" in args
    args = [a for a in args if a not in ("--headless", "--json")]

    if len(args) >= 2:
        username, password = args[0], args[1]
    else:
        username = input("Student ID: ")
        password = input("Password: ")

    if json_out:
        data = get_schedule_json(username, password, headless=headless)
        print(json.dumps(data, ensure_ascii=False))
    else:
        run_scraper(username, password)
