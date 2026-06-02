import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('attendance');
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [visits, setVisits] = useState([]);

  useEffect(() => {
    fetchData();

    // Setup Realtime subscriptions
    const staffSub = supabase.channel('public:staff')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, fetchData)
      .subscribe();
      
    const attSub = supabase.channel('public:attendance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, fetchData)
      .subscribe();
      
    const visitsSub = supabase.channel('public:visits')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(staffSub);
      supabase.removeChannel(attSub);
      supabase.removeChannel(visitsSub);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [staffRes, attRes, visitsRes] = await Promise.all([
        supabase.from('staff').select('*'),
        supabase.from('attendance').select('*').order('timestamp', { ascending: false }),
        supabase.from('visits').select('*').order('time_in', { ascending: false })
      ]);

      if (staffRes.data) setStaffList(staffRes.data);
      if (attRes.data) setAttendance(attRes.data);
      if (visitsRes.data) setVisits(visitsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStaffName = (id) => {
    const staff = staffList.find(s => s.id === id);
    return staff ? staff.name : 'Unknown Staff';
  };

  // Compute Summary Statistics
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  
  const presentToday = new Set(
    attendance
      .filter(a => new Date(a.timestamp) >= todayStart && a.type === 'WORK_IN')
      .map(a => a.staff_id)
  ).size;

  const activeVisits = visits.filter(v => !v.time_out).length;

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  const MapLink = ({ lat, lng }) => {
    if (!lat || !lng) return <span>-</span>;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    return (
      <a href={url} target="_blank" rel="noreferrer" className="map-link">
        📍 View Map
      </a>
    );
  };

  const Badge = ({ type }) => {
    let className = 'badge ';
    let text = type;
    
    if (type === 'WORK_IN') { className += 'work-in'; text = 'WORK IN'; }
    else if (type === 'WORK_OUT') { className += 'work-out'; text = 'WORK OUT'; }
    else if (type === 'LEAVE') { className += 'leave'; text = 'LEAVE'; }
    else { className += 'visit'; }

    return <span className={className}>{text}</span>;
  };

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <p>Loading Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <header className="header">
        <div>
          <h1>JA Staff Central</h1>
          <p>Real-time Attendance and Visit Tracking</p>
        </div>
      </header>

      <div className="summary-grid">
        <div className="glass-panel summary-card">
          <div className="summary-icon">👥</div>
          <div className="summary-content">
            <h3>Total Staff</h3>
            <div className="value">{staffList.length}</div>
          </div>
        </div>
        <div className="glass-panel summary-card">
          <div className="summary-icon">✅</div>
          <div className="summary-content">
            <h3>Present Today</h3>
            <div className="value">{presentToday}</div>
          </div>
        </div>
        <div className="glass-panel summary-card">
          <div className="summary-icon">🏪</div>
          <div className="summary-content">
            <h3>Active Visits</h3>
            <div className="value">{activeVisits}</div>
          </div>
        </div>
      </div>

      <div className="glass-panel">
        <div className="tabs">
          <button 
            className={`tab-button ${activeTab === 'attendance' ? 'active' : ''}`}
            onClick={() => setActiveTab('attendance')}
          >
            Attendance Logs
          </button>
          <button 
            className={`tab-button ${activeTab === 'visits' ? 'active' : ''}`}
            onClick={() => setActiveTab('visits')}
          >
            Visit Logs
          </button>
        </div>

        <div className="table-container">
          {activeTab === 'attendance' && (
            <table>
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Staff Member</th>
                  <th>Type</th>
                  <th>Reason (Leave)</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {attendance.length === 0 ? (
                  <tr><td colSpan="5" style={{textAlign: 'center', padding: '40px'}}>No logs found</td></tr>
                ) : (
                  attendance.map(log => (
                    <tr key={log.id}>
                      <td>{formatDate(log.timestamp)}</td>
                      <td style={{fontWeight: 600}}>{getStaffName(log.staff_id)}</td>
                      <td><Badge type={log.type} /></td>
                      <td style={{color: 'var(--warning)'}}>{log.reason || '-'}</td>
                      <td><MapLink lat={log.lat} lng={log.lng} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'visits' && (
            <table>
              <thead>
                <tr>
                  <th>Staff Member</th>
                  <th>Shop Name</th>
                  <th>Time IN</th>
                  <th>Time OUT</th>
                  <th>Location IN</th>
                  <th>Location OUT</th>
                </tr>
              </thead>
              <tbody>
                {visits.length === 0 ? (
                  <tr><td colSpan="6" style={{textAlign: 'center', padding: '40px'}}>No visits found</td></tr>
                ) : (
                  visits.map(visit => (
                    <tr key={visit.id}>
                      <td style={{fontWeight: 600}}>{getStaffName(visit.staff_id)}</td>
                      <td>{visit.shop_name}</td>
                      <td>{formatDate(visit.time_in)}</td>
                      <td>{visit.time_out ? formatDate(visit.time_out) : <span style={{color: 'var(--primary-color)'}}>Ongoing</span>}</td>
                      <td><MapLink lat={visit.lat_in} lng={visit.lng_in} /></td>
                      <td><MapLink lat={visit.lat_out} lng={visit.lng_out} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <footer className="footer">
        DEVELOPED BY JANAKA SANJEEWA &copy; {new Date().getFullYear()} | JA STAFF
      </footer>
    </div>
  );
}

export default App;
