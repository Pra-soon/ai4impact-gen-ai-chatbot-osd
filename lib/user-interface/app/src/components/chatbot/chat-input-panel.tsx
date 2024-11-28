import {
  Button,
  Container,
  Icon,
  Select,
  SelectProps,
  SpaceBetween,
  Spinner,
  StatusIndicator,
} from "@cloudscape-design/components";
import {
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import SpeechRecognition, {
  useSpeechRecognition,
} from "react-speech-recognition";
import { Auth } from "aws-amplify";
import TextareaAutosize from "react-textarea-autosize";
import { ReadyState } from "react-use-websocket";
import { ApiClient } from "../../common/api-client/api-client";
import { AppContext } from "../../common/app-context";
import styles from "../../styles/chat.module.scss";

import {  
  ChatBotHistoryItem,  
  ChatBotMessageType,
  ChatInputState,  
} from "./types";

import {  
  assembleHistory
} from "./utils";

import { Utils } from "../../common/utils";
import {SessionRefreshContext} from "../../common/session-refresh-context"
import { useNotifications } from "../notif-manager";

export interface ChatInputPanelProps {
  running: boolean;
  setRunning: Dispatch<SetStateAction<boolean>>;
  session: { id: string; loading: boolean };
  messageHistory: ChatBotHistoryItem[];
  setMessageHistory: (history: ChatBotHistoryItem[]) => void;  
}

export abstract class ChatScrollState {
  static userHasScrolled = false;
  static skipNextScrollEvent = false;
  static skipNextHistoryUpdate = false;
}

export default function ChatInputPanel(props: ChatInputPanelProps) {
  const appContext = useContext(AppContext);
  const {needsRefresh, setNeedsRefresh} = useContext(SessionRefreshContext);  
  const { transcript, listening, browserSupportsSpeechRecognition } =
    useSpeechRecognition();
  const [state, setState] = useState<ChatInputState>({
    value: "",
    
  });
  const { notifications, addNotification } = useNotifications();
  const [readyState, setReadyState] = useState<ReadyState>(
    ReadyState.OPEN
  );  
  const messageHistoryRef = useRef<ChatBotHistoryItem[]>([]);

  const [
    selectedDataSource,
    setSelectedDataSource
  ] = useState({ label: "Bedrock Knowledge Base", value: "kb" } as SelectProps.ChangeDetail["selectedOption"]);

  const [receivedData, setReceivedData] = useState('');
  const [sources, setSources] = useState({});

  useEffect(() => {
    messageHistoryRef.current = props.messageHistory;    
  }, [props.messageHistory]);
  


  /** Speech recognition */
  useEffect(() => {
    if (transcript) {
      setState((state) => ({ ...state, value: transcript }));
    }
  }, [transcript]);


  /**Some amount of auto-scrolling for convenience */
  useEffect(() => {
    const onWindowScroll = () => {
      if (ChatScrollState.skipNextScrollEvent) {
        ChatScrollState.skipNextScrollEvent = false;
        return;
      }

      const isScrollToTheEnd =
        Math.abs(
          window.innerHeight +
          window.scrollY -
          document.documentElement.scrollHeight
        ) <= 10;

      if (!isScrollToTheEnd) {
        ChatScrollState.userHasScrolled = true;
      } else {
        ChatScrollState.userHasScrolled = false;
      }
    };

    window.addEventListener("scroll", onWindowScroll);

    return () => {
      window.removeEventListener("scroll", onWindowScroll);
    };
  }, []);

  useLayoutEffect(() => {
    if (ChatScrollState.skipNextHistoryUpdate) {
      ChatScrollState.skipNextHistoryUpdate = false;
      return;
    }

    if (!ChatScrollState.userHasScrolled && props.messageHistory.length > 0) {
      ChatScrollState.skipNextScrollEvent = true;
      window.scrollTo({
        top: document.documentElement.scrollHeight + 1000,
        behavior: "instant",
      });
    }
  }, [props.messageHistory]);

  /**Sends a message to the chat API */
  const handleSendMessage = async () => {    
    if (props.running) return;
    if (readyState !== ReadyState.OPEN) return;
    ChatScrollState.userHasScrolled = false;

    let username;
    await Auth.currentAuthenticatedUser().then((value) => username = value.username);
    if (!username) return;    

    const messageToSend = state.value.trim();
    if (messageToSend.length === 0) {
      addNotification("error","Please do not submit blank text!");
      return;          
    }
    setState({ value: "" });    
    
    try {
      props.setRunning(true);
      let receivedData = '';      
      
      /**Add the user's query to the message history and a blank dummy message
       * for the chatbot as the response loads
       */
      messageHistoryRef.current = [
        ...messageHistoryRef.current.slice(0, -2),
        {
          type: ChatBotMessageType.Human,
          content: messageToSend,
          metadata: {},
        },
        {
          type: ChatBotMessageType.AI,
          content: receivedData || '',
          metadata: sources || {},
        },
      ];
      props.setMessageHistory(messageHistoryRef.current);

      let firstTime = false;
      if (messageHistoryRef.current.length < 3) {
        firstTime = true;
      }
      // old non-auth url -> const wsUrl = 'wss://ngdpdxffy0.execute-api.us-east-1.amazonaws.com/test/'; 
      // old shared url with auth -> wss://caoyb4x42c.execute-api.us-east-1.amazonaws.com/test/     
      // first deployment URL 'wss://zrkw21d01g.execute-api.us-east-1.amazonaws.com/prod/';
      const TEST_URL = appContext.wsEndpoint+"/"

      // Get a JWT token for the API to authenticate on      
      const TOKEN = await Utils.authenticate()
                
      const wsUrl = TEST_URL+'?Authorization='+TOKEN;
      const ws = new WebSocket(wsUrl);

      let incomingMetadata: boolean = false;
      let receivedData = '';
      let sources = {};

      /**If there is no response after a minute, time out the response to try again. */
      setTimeout(() => {if (receivedData == '') {
        ws.close()
        messageHistoryRef.current.pop();
        messageHistoryRef.current.push({
          type: ChatBotMessageType.AI,          
          content: 'Response timed out!',
          metadata: {},
        })
      }},60000)

      // Event listener for when the connection is open
      ws.addEventListener('open', function open() {
        console.log('Connected to the WebSocket server');        
        const message = JSON.stringify({
          "action": "getChatbotResponse",
          "data": {
            userMessage: messageToSend,
            chatHistory: assembleHistory(messageHistoryRef.current.slice(0, -2)),
            systemPrompt: `
            Purpose: This agent is designed to assist users in navigating the procurement process by referencing two key documents: SWCIndex and the OSD procurement handbook. The goal is to guide buyers and executive office staff through compliance procedures while providing clear, step-by-step instructions for efficient decision-making.
            
**Example Interaction when user wants guidance:**
- **User:** "Which platform should I use to place bids?"
- **Agent:** "You can use COMMBUYS for the purpose of placing bids. Although you may want to reference specific contract user guides to cross verify in case of any exception."
`,
            projectId: 'rsrs111111',
            user_id: username,
            session_id: props.session.id,
            retrievalSource: selectedDataSource.value
          }
        });
        
        ws.send(message);
        
      });
      // Event listener for incoming messages
      ws.addEventListener('message', async function incoming(data) {
        if (data.data.includes("<!ERROR!>:")) {
          addNotification("error",data.data);          
          ws.close();
          return;
        }
        
        if (data.data == '!<|EOF_STREAM|>!') {          
          incomingMetadata = true;
          return;          
        }

        if (!incomingMetadata) {
          setReceivedData(prev => prev + data.data);
          
          messageHistoryRef.current = [
            ...messageHistoryRef.current.slice(0, -2),
            {
              type: ChatBotMessageType.Human,
              content: messageToSend,
              metadata: {},
            },
            {
              type: ChatBotMessageType.AI,
              content: receivedData + data.data,
              metadata: sources,
            },
          ];
          props.setMessageHistory(messageHistoryRef.current);
        } else {
          try {
            let sourceData = JSON.parse(data.data);
            console.log("Raw source data:", sourceData);
            
            sourceData = sourceData.map((item) => ({
              title: item.title || item.uri.split("/").pop(),
              uri: item.uri
            }));
            
            const newSources = { "Sources": sourceData };
            setSources(newSources);
            console.log("Processed sources:", newSources);
            
            messageHistoryRef.current = [
              ...messageHistoryRef.current.slice(0, -1),
              {
                type: ChatBotMessageType.AI,
                content: receivedData,
                metadata: newSources
              }
            ];
            props.setMessageHistory(messageHistoryRef.current);
          } catch (error) {
            console.error("Error processing sources:", error);
          }
        }
      });
      // Handle possible errors
      ws.addEventListener('error', function error(err) {
        console.error('WebSocket error:', err);
      });
      // Handle WebSocket closure
      ws.addEventListener('close', async function close() {
        // if this is a new session, the backend will update the session list, so
        // we need to refresh        
        if (firstTime) {             
          Utils.delay(1500).then(() => setNeedsRefresh(true));
        }
        props.setRunning(false);        
        console.log('Disconnected from the WebSocket server');
      });

    } catch (error) {      
      console.error('Error sending message:', error);
      alert('Sorry, something has gone horribly wrong! Please try again or refresh the page.');
      props.setRunning(false);
    }     
  };

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Open",
    [ReadyState.CLOSING]: "Closing",
    [ReadyState.CLOSED]: "Closed",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  return (
    <SpaceBetween direction="vertical" size="l">
      <Container>
        <div className={styles.input_textarea_container}>
          <SpaceBetween size="xxs" direction="horizontal" alignItems="center">
            {browserSupportsSpeechRecognition ? (
              <Button
                iconName={listening ? "microphone-off" : "microphone"}
                variant="icon"
                ariaLabel="microphone-access"
                onClick={() =>
                  listening
                    ? SpeechRecognition.stopListening()
                    : SpeechRecognition.startListening()
                }
              />
            ) : (
              <Icon name="microphone-off" variant="disabled" />
            )}
          </SpaceBetween>          
          <TextareaAutosize
            className={styles.input_textarea}
            maxRows={6}
            minRows={1}
            spellCheck={true}
            autoFocus
            onChange={(e) =>
              setState((state) => ({ ...state, value: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key == "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            value={state.value}
            placeholder={"Message ABE"}
          />
          <div style={{ marginLeft: "8px" }}>            
            <Button
              disabled={
                readyState !== ReadyState.OPEN ||                
                props.running ||
                state.value.trim().length === 0 ||
                props.session.loading
              }
              onClick={handleSendMessage}
              iconAlign="right"
              iconName={!props.running ? "angle-right-double" : undefined}
              variant="primary"
            >
              {props.running ? (
                <>
                  Loading&nbsp;&nbsp;
                  <Spinner />
                </>
              ) : (
                "Send"
              )}
            </Button>
          </div>
        </div>
      </Container>
      <div className={styles.input_controls}>      
        <div>
        </div>  
        <div className={styles.input_controls_right}>
          <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
            <div style={{ paddingTop: "1px" }}>              
            </div>            
          </SpaceBetween>
        </div>
      </div>
    </SpaceBetween>
  );
}

