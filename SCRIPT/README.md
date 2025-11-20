# Siam University Data Scraper

This tool is designed to scrape data from the Siam University student portal, including timetable information. It includes both a comprehensive data scraper and a simplified automation script based on Axiom automation.

## Features

- Logs into the Siam University student portal
- Navigates through the portal interface
- Extracts timetable data
- Saves data in JSON format
- Takes screenshots for verification

## Requirements

- Python 3.6+
- Chrome browser
- Required Python packages (see requirements.txt)

## Installation

1. Install Python from [python.org](https://www.python.org/downloads/)
2. Install required packages:

```
pip install -r requirements.txt
```

3. Make sure Chrome browser is installed on your system

## Usage

### Full Data Scraper

Run the comprehensive scraper with:

```
python scrapper.py
```

The script will:
1. Open a Chrome browser window
2. Navigate to the Siam University portal
3. Switch to English language
4. Log in with the provided credentials
5. Navigate to the timetable page
6. Extract timetable data
7. Save the data to `siam_university_data.json`
8. Take a screenshot of the timetable and save it as `timetable_screenshot.png`

### Axiom-based Automation

Run the simplified automation script (based on Axiom automation) with:

```
python axiom_automation.py
```

This script will:
1. Open a Chrome browser window
2. Navigate to the Siam University portal
3. Switch to English language
4. Click on the login link
5. Enter the username and password
6. Submit the login form
7. Keep the browser open for inspection

### New Axiom-based Automation

Run the new automation script (based on the updated Axiom automation) with:

```
python axiom_new_automation.py
```

This script will:
1. Open a Chrome browser window
2. Navigate to the Siam University portal
3. Switch to English language
4. Click on the login link
5. Enter the username and password
6. Submit the login form
7. Scrape data from the page after login
8. Keep the browser open for inspection

## Configuration

### Full Data Scraper

You can modify the login credentials in the script by changing the parameters in the `SiamUniversityScraper` class initialization:

```python
scraper = SiamUniversityScraper(login_code="YOUR_ID", password="YOUR_PASSWORD")
```

### Axiom-based Automation

You can modify the login credentials in the axiom_automation.py script by changing the parameters when running the script or by modifying the default values in the `SiamUniversityAutomation` class initialization:

```python
automation = SiamUniversityAutomation(username="YOUR_ID", password="YOUR_PASSWORD")
```

### New Axiom-based Automation

You can modify the login credentials in the axiom_new_automation.py script by changing the parameters when running the script or by modifying the default values in the `SiamUniversityAutomation` class initialization:

```python
automation = SiamUniversityAutomation(username="YOUR_ID", password="YOUR_PASSWORD")
```

## Output

### Full Data Scraper

The scrapper.py script generates two output files:

1. `siam_university_data.json` - Contains all scraped data including timetable information
2. `timetable_screenshot.png` - A screenshot of the timetable page for verification

### Axiom-based Automation

The axiom_automation.py script doesn't generate output files by default, but it keeps the browser window open after login for manual inspection and interaction.

### New Axiom-based Automation

The axiom_new_automation.py script keeps the browser open by default for inspection and scrapes data from the page after login.