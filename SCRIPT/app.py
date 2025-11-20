from flask import Flask, request, jsonify
import subprocess  # To call the Python script for scraping

app = Flask(__name__)

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if username and password:
        try:
            # Call the Python script to scrape the schedule
            subprocess.run(['python', 'generate_schedule_json.py', username, password], check=True)

            # Return a success message
            return jsonify({'success': True, 'message': 'Schedule generated successfully!'})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)})

    return jsonify({'success': False, 'message': 'Invalid credentials'})

if __name__ == '__main__':
    app.run(debug=True)
