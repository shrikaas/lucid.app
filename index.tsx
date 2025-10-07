/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from '@google/genai';
import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

interface ParsedTask {
  id: number;
  taskName: string;
  date: string;
  time: string | null;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  status: 'active' | 'completed';
  source: 'lucid' | 'google';
}

interface PomodoroSettings {
  work: number;
  shortBreak: number;
  longBreak: number;
  cycles: number;
}

interface ActiveTimer {
  taskId: number;
  timeLeft: number;
  mode: 'work' | 'shortBreak' | 'longBreak';
  cycleCount: number;
  isPaused: boolean;
}

const TASK_CATEGORIES = ['Work', 'Personal', 'Study', 'Health', 'Other'];
const TASK_PRIORITIES = ['High', 'Medium', 'Low'];
const DEFAULT_SETTINGS: PomodoroSettings = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
  cycles: 4,
};

function App() {
  const [userInput, setUserInput] = useState('');
  const [parsedTask, setParsedTask] = useState<Omit<ParsedTask, 'id' | 'status' | 'source'> | null>(null);
  const [editedTask, setEditedTask] = useState<Omit<ParsedTask, 'id' | 'status' | 'source'> | null>(null);
  const [tasks, setTasks] = useState<ParsedTask[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [pomodoroSettings, setPomodoroSettings] = useState<PomodoroSettings>(DEFAULT_SETTINGS);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [googleCalendarSync, setGoogleCalendarSync] = useState({ connected: false, user: null as string | null });

  // Pomodoro Timer Logic
  useEffect(() => {
    if (!activeTimer || activeTimer.isPaused) return;

    const interval = setInterval(() => {
      setActiveTimer(prev => {
        if (!prev) return null;
        if (prev.timeLeft > 1) {
          return { ...prev, timeLeft: prev.timeLeft - 1 };
        }

        // Timer finished, transition to next state
        transitionToNextMode(prev);
        return null; // Stop old timer, new one will be set
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimer, pomodoroSettings]);

  const transitionToNextMode = (currentTimer: ActiveTimer) => {
    if (currentTimer.mode === 'work') {
      const newCycleCount = currentTimer.cycleCount + 1;
      const isLongBreakTime = newCycleCount % pomodoroSettings.cycles === 0;
      
      if (isLongBreakTime) {
        setActiveTimer({ 
          ...currentTimer, 
          mode: 'longBreak', 
          timeLeft: pomodoroSettings.longBreak * 60,
          cycleCount: newCycleCount
        });
      } else {
        setActiveTimer({ 
          ...currentTimer, 
          mode: 'shortBreak', 
          timeLeft: pomodoroSettings.shortBreak * 60,
          cycleCount: newCycleCount
        });
      }
    } else { // It was a break
      setActiveTimer({ 
        ...currentTimer, 
        mode: 'work', 
        timeLeft: pomodoroSettings.work * 60
      });
    }
  };

  const handleStartTimer = (taskId: number) => {
    setActiveTimer({
      taskId,
      timeLeft: pomodoroSettings.work * 60,
      mode: 'work',
      cycleCount: 0,
      isPaused: false,
    });
  };

  const handlePauseResumeTimer = () => {
    setActiveTimer(prev => prev ? { ...prev, isPaused: !prev.isPaused } : null);
  };
  
  const handleSkip = () => {
      if (activeTimer) {
          transitionToNextMode(activeTimer);
      }
  };

  const handleResetTimer = () => {
    setActiveTimer(null);
  };
  
  const handleSettingsChange = (field: keyof PomodoroSettings, value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue > 0) {
      setPomodoroSettings(prev => ({ ...prev, [field]: numValue }));
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleSubmit = async () => {
    if (!userInput.trim()) return;

    setIsLoading(true);
    setError(null);
    setParsedTask(null);
    setIsEditing(false);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userInput,
        config: {
          systemInstruction: `You are an intelligent scheduling assistant. 
            Your role is to parse user input about tasks and events and convert it into a structured JSON format. 
            Analyze the text to identify the task description, date, time, a relevant category, and its priority.
            - Today's date is ${new Date().toLocaleDateString()}.
            - Default to a relevant category if one isn't specified. Valid categories are: ${TASK_CATEGORIES.join(', ')}.
            - Determine a priority for the task (High, Medium, or Low) based on wording (e.g., 'urgent', 'asap' implies High). Default to Medium if unsure.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              taskName: {
                type: Type.STRING,
                description: 'The name or description of the task.',
              },
              date: {
                type: Type.STRING,
                description: "The date of the task in 'Month Day, Year' format (e.g., 'July 26, 2024').",
              },
              time: {
                type: Type.STRING,
                description: "The time of the task in 'HH:MM AM/PM' format. If not specified, return null.",
              },
              category: {
                type: Type.STRING,
                description: `A suggested category for the task (${TASK_CATEGORIES.join(', ')}).`,
              },
              priority: {
                type: Type.STRING,
                description: 'The priority of the task (High, Medium, Low).',
              },
            },
            required: ['taskName', 'date', 'category', 'priority'],
          },
        },
      });

      const parsedJson = JSON.parse(response.text);
      setParsedTask(parsedJson);
      setEditedTask(parsedJson);

    } catch (e) {
      console.error(e);
      setError('Sorry, I had trouble understanding that. Please try rephrasing your request.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleAccept = () => {
    if (parsedTask) {
      const newTask: ParsedTask = { ...parsedTask, id: Date.now(), status: 'active', source: 'lucid' };
      setTasks([...tasks, newTask]);
      setParsedTask(null);
      setUserInput('');
    }
  };

  const handleCancel = () => {
    setParsedTask(null);
    setEditedTask(null);
  };

  const handleSaveEdit = () => {
    if (editedTask) {
        setParsedTask(editedTask);
        setIsEditing(false);
    }
  };
  
  const handleEditChange = (field: keyof Omit<ParsedTask, 'id' | 'status' | 'source'>, value: string) => {
    if (editedTask) {
      setEditedTask({ ...editedTask, [field]: value });
    }
  };

  const handleToggleComplete = (taskId: number) => {
    setTasks(tasks.map(task => 
      task.id === taskId 
        ? { ...task, status: task.status === 'active' ? 'completed' : 'active' } 
        : task
    ));
    if (activeTimer?.taskId === taskId) {
      setActiveTimer(null);
    }
  };

  const handleEventDrop = (info: any) => {
    const { event } = info;
    const taskId = Number(event.id);
    const newStartDate = event.start;

    setTasks(currentTasks => currentTasks.map(task => {
        if (task.id === taskId) {
            const updatedTask = { ...task };
            updatedTask.date = newStartDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            
            if (event.allDay) {
                updatedTask.time = null;
            } else {
                updatedTask.time = newStartDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
            return updatedTask;
        }
        return task;
    }));
  };

  const handleConnectGoogleCalendar = () => {
    setGoogleCalendarSync({ connected: true, user: 'user@example.com' });
  };
  
  const handleDisconnectGoogleCalendar = () => {
    setGoogleCalendarSync({ connected: false, user: null });
    setTasks(prevTasks => prevTasks.filter(task => task.source !== 'google'));
  };

  const handleSyncNow = () => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const googleEvents: ParsedTask[] = [
      {
        id: Date.now(),
        taskName: "Team Standup",
        date: today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        time: '10:00 AM',
        category: 'Work',
        priority: 'Medium',
        status: 'active',
        source: 'google'
      },
      {
        id: Date.now() + 1,
        taskName: "Design Review",
        date: tomorrow.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        time: '2:30 PM',
        category: 'Work',
        priority: 'High',
        status: 'active',
        source: 'google'
      }
    ];
    setTasks(prevTasks => [...prevTasks.filter(t => t.source !== 'google'), ...googleEvents]);
    setIsSettingsOpen(false);
  };

  const activeTasks = tasks.filter(task => task.status === 'active');
  const completedTasks = tasks.filter(task => task.status === 'completed');
  
  const priorityOrder = { 'High': 1, 'Medium': 2, 'Low': 3 };
  const sortedActiveTasks = [...activeTasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const parseTaskDateTime = (task: ParsedTask): Date | null => {
    if (!task.date) return null;
    const dateTimeString = task.time ? `${task.date} ${task.time}` : task.date;
    const date = new Date(dateTimeString);
    if (isNaN(date.getTime())) {
        console.warn('Invalid date string for task:', task);
        return null;
    }
    return date;
  };

  const calendarEvents = activeTasks.map(task => {
    const start = parseTaskDateTime(task);
    if (!start) return null;
    return {
      id: task.id.toString(),
      title: task.taskName,
      start: start,
      allDay: !task.time,
      className: `category-${task.category.toLowerCase()} ${task.source === 'google' ? 'google-event' : ''} priority-${task.priority.toLowerCase()}`
    };
  }).filter(Boolean);

  return (
    <main>
      <header>
        <div className="header-content">
          <h1>Lucid</h1>
          <p>Your intelligent assistant for planning and productivity.</p>
        </div>
        <button className="btn-settings" onClick={() => setIsSettingsOpen(true)} title="Settings">⚙️</button>
      </header>
      
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="btn-close-modal" onClick={() => setIsSettingsOpen(false)}>×</button>
            <div className="pomodoro-settings">
              <h2>Pomodoro Settings</h2>
              <div className="settings-grid">
                <label>Work (min) <input type="number" value={pomodoroSettings.work} onChange={(e) => handleSettingsChange('work', e.target.value)} /></label>
                <label>Short Break (min) <input type="number" value={pomodoroSettings.shortBreak} onChange={(e) => handleSettingsChange('shortBreak', e.target.value)} /></label>
                <label>Long Break (min) <input type="number" value={pomodoroSettings.longBreak} onChange={(e) => handleSettingsChange('longBreak', e.target.value)} /></label>
                <label>Cycles <input type="number" value={pomodoroSettings.cycles} onChange={(e) => handleSettingsChange('cycles', e.target.value)} /></label>
              </div>
            </div>
            <div className="integrations-section">
              <h2>Integrations</h2>
              {googleCalendarSync.connected ? (
                <div className="integration-status">
                  <p>Connected as: <strong>{googleCalendarSync.user}</strong></p>
                  <div className="integration-actions">
                    <button onClick={handleSyncNow}>Sync Now</button>
                    <button className="btn-secondary" onClick={handleDisconnectGoogleCalendar}>Disconnect</button>
                  </div>
                </div>
              ) : (
                <button onClick={handleConnectGoogleCalendar}>Connect Google Calendar</button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="input-section">
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="e.g., Meeting with Jake at 3 PM Thursday..."
          aria-label="Enter your task"
          disabled={isLoading}
        />
        <button onClick={handleSubmit} disabled={isLoading || !userInput.trim()}>
          {isLoading ? 'Processing...' : 'Schedule Task'}
        </button>
      </div>

      {isLoading && <div className="loading">Lucid is thinking...</div>}
      {error && <div className="error" role="alert">{error}</div>}
      
      {parsedTask && !isLoading && (
        <div className="result-card" role="region" aria-live="polite">
          {!isEditing ? (
            <>
              <h2>Task Details</h2>
              <p><strong>Task:</strong> {parsedTask.taskName}</p>
              <p><strong>Date:</strong> {parsedTask.date}</p>
              {parsedTask.time && <p><strong>Time:</strong> {parsedTask.time}</p>}
              <p><strong>Priority:</strong> {parsedTask.priority}</p>
              <p><strong>Category:</strong> 
                <span className={`category-badge ${parsedTask.category.toLowerCase()}`}>
                  {parsedTask.category}
                </span>
              </p>
              <div className="actions">
                <button className="btn-secondary" onClick={() => setIsEditing(true)}>✏️ Edit</button>
                <button className="btn-secondary" onClick={handleCancel}>❌ Cancel</button>
                <button className="btn-primary" onClick={handleAccept}>✅ Accept</button>
              </div>
            </>
          ) : (
            <div className="edit-form">
              <h2>Edit Task</h2>
              <label>Task <input type="text" value={editedTask?.taskName || ''} onChange={(e) => handleEditChange('taskName', e.target.value)} /></label>
              <label>Date <input type="text" value={editedTask?.date || ''} onChange={(e) => handleEditChange('date', e.target.value)} /></label>
              <label>Time <input type="text" value={editedTask?.time || ''} onChange={(e) => handleEditChange('time', e.target.value)} /></label>
              <label>Category
                <select value={editedTask?.category || ''} onChange={(e) => handleEditChange('category', e.target.value)}>
                  {TASK_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </label>
              <label>Priority
                <select value={editedTask?.priority || 'Medium'} onChange={(e) => handleEditChange('priority', e.target.value as 'High' | 'Medium' | 'Low')}>
                  {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <div className="actions">
                <button className="btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleSaveEdit}>Save Changes</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="view-switcher">
        <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'active' : ''}>Task View</button>
        <button onClick={() => setViewMode('calendar')} className={viewMode === 'calendar' ? 'active' : ''}>Calendar View</button>
      </div>
      
      {viewMode === 'list' ? (
        <>
          {activeTasks.length > 0 && (
            <div className="task-list">
              <h2>Accepted Tasks</h2>
              <ul>
                {sortedActiveTasks.map((task) => {
                  const isTimerActiveForTask = activeTimer?.taskId === task.id;
                  return (
                  <li key={task.id} className={`${isTimerActiveForTask ? 'active-timer' : ''} priority-${task.priority.toLowerCase()}`}>
                    <div className="task-details">
                      <div className="task-info">
                        <span>
                          {task.source === 'google' && <span className="google-event-icon" title="From Google Calendar">🇬</span>}
                          {task.taskName}
                        </span>
                        <small>{task.date} {task.time}</small>
                      </div>
                      <span className={`category-badge ${task.category.toLowerCase()}`}>{task.category}</span>
                    </div>
                    <div className="task-actions">
                      <div className="timer-section">
                        {isTimerActiveForTask ? (
                          <div className="timer-controls">
                            <div className="timer-display">
                              <span className="timer-mode">
                                {activeTimer.mode === 'work' ? 'Work' : activeTimer.mode === 'shortBreak' ? 'Short Break' : 'Long Break'}
                              </span>
                              <span className="timer-time">{formatTime(activeTimer.timeLeft)}</span>
                            </div>
                            <button className="timer-btn" onClick={handlePauseResumeTimer} title={activeTimer.isPaused ? 'Resume' : 'Pause'}>
                              {activeTimer.isPaused ? '▶️' : '⏸️'}
                            </button>
                            <button className="timer-btn" onClick={handleSkip} title={activeTimer.mode === 'work' ? 'Skip to Break' : 'Skip to Work'}>⏭️</button>
                            <button className="timer-btn" onClick={handleResetTimer} title="Reset">🔄</button>
                          </div>
                        ) : (
                          <button 
                            className="btn-start-timer" 
                            onClick={() => handleStartTimer(task.id)}
                            disabled={!!activeTimer}
                          >
                            Start Timer
                          </button>
                        )}
                      </div>
                      <button className="btn-complete" onClick={() => handleToggleComplete(task.id)} title="Complete Task">✔️</button>
                    </div>
                  </li>
                )})}
              </ul>
            </div>
          )}

          {completedTasks.length > 0 && (
            <div className="task-list">
              <h2>Completed Tasks</h2>
              <ul>
                {completedTasks.map((task) => (
                  <li key={task.id} className="completed">
                    <div className="task-details">
                      <div className="task-info">
                        <span>
                          {task.source === 'google' && <span className="google-event-icon" title="From Google Calendar">🇬</span>}
                          {task.taskName}
                        </span>
                        <small>{task.date} {task.time}</small>
                      </div>
                      <span className={`category-badge ${task.category.toLowerCase()}`}>{task.category}</span>
                    </div>
                    <div className="task-actions">
                      <button className="btn-revive" onClick={() => handleToggleComplete(task.id)}>⤴️ Revive</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="calendar-container">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            }}
            events={calendarEvents as any}
            editable={true}
            eventDrop={handleEventDrop}
          />
        </div>
      )}
    </main>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);