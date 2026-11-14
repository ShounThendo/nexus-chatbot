# Nexus: NLP Chatbot for Everyday Life Assistance

Nexus is a chatbot I built as my final year BTech Computer Engineering project at CPUT. You type a prompt and it replies based on what you ask for.

## Features
- Chat replies based on the user's prompt
- Reminders
- Habit tracking
- Calendar
- Weather information

## Built with
Python, HTML, CSS, JavaScript

## Model
Nexus generates replies with Qwen3 (1.7B), run locally through Ollama.

1. Install Ollama from ollama.com
2. Download the model: `ollama pull qwen3:1.7b`
3. Make sure Ollama is running before you start Nexus

## How to run
1. Install Python 3
2. Set up the model (see Model above)
3. Install the requirements: `pip install -r python/requirements.txt`
4. Add your own weather API key in `python/Services/apis.py`
5. Start the server: `python python/server.py`
6. Open the local address shown in the terminal in your browser
