var Line = new Meteor.Collection("line");

var stops = [];

if (Meteor.isClient) {
  Session.set("line", "L13");
  Session.set("direction", "Drammen");

  Template.train.stops = function () {
    stops = [];
    console.log(Session.get("Line") + ":" +  Session.get("direction"));
    var line = Line.findOne({lineNo:Session.get("line"), destination:Session.get("direction")})
    console.log(line);
    if(line !== undefined && line.stops != undefined){
      console.log("Found some stops");
      return line.stops
    }
  };
  
   
  var addOption = function(select, text){
            console.log("Adding options : " + text);
            var option = document.createElement("option");
            option.text = text;
            option.value = text;
            select.appendChild(option);
  }


  Template.train.events({
    'change #line' : function(event){
        console.log("Changing line");
        var selectLineBox = document.getElementById("line");
        var selectedLine = selectLineBox.options[selectLineBox.selectedIndex].text;
        var selectDirectionBox = document.getElementById("direction");        
        selectDirectionBox.options.length = 0;
        console.log("Adding options.")
        
        if(selectedLine==="L2"){
            addOption(selectDirectionBox,"Ski");
            addOption(selectDirectionBox,"Skøyen");
        } else if(selectedLine==="L3"){
            addOption(selectDirectionBox,"Jaren");
            addOption(selectDirectionBox,"Oslo S");
        } else if(selectedLine==="L12"){
            addOption(selectDirectionBox,"Kongsberg");
            addOption(selectDirectionBox,"Eidsvoll");
        } else if(selectedLine==="L13"){
            addOption(selectDirectionBox,"Dal");
            addOption(selectDirectionBox,"Drammen");
        } else if(selectedLine==="L14"){
            addOption(selectDirectionBox,"Kongsvinger");
            addOption(selectDirectionBox,"Asker");
        } else if(selectedLine==="L21"){
            addOption(selectDirectionBox,"Skøyen");
            addOption(selectDirectionBox,"Moss");
        } else if(selectedLine==="L22"){
            addOption(selectDirectionBox,"Skøyen");
            addOption(selectDirectionBox,"Rakkestad");
        }

        var selectedDirection = selectDirectionBox.options[0].text;
        Session.set("line", selectedLine);
        Session.set("direction", selectedDirection);
    },



    'change #direction' : function(event){
        console.log("Changing direction");
        var selectBox = document.getElementById("direction");
        var selectedDirection = selectBox.options[selectBox.selectedIndex].text;
        Session.set("direction", selectedDirection);
    }
  })

  
}

if (Meteor.isServer) {

  var chachedCalls = []

  var callRuter = function(stop,stopid){
    var result = findCachedStation(stopid);
    if(result === undefined){
      console.log(stop + " - http://reis.trafikanten.no/reisrest/realtime/getrealtimedata/"+stopid);
      var returnThis;
      try {
        result = HTTP.call("GET", "http://reis.trafikanten.no/reisrest/realtime/getrealtimedata/"+stopid);
        cacheStation(stopid,result);
      } catch(err) {
        console.log("Problem getting " + stop);
      }
    }
    return result;
  };


  var cacheStation = function(stopid,result){
    chachedCalls.push({stopid:stopid,result:result})
  }

  var findCachedStation = function(stopid) {
    if( stopid === undefined ) return undefined;
    for (var i = 0; i < chachedCalls.length; i++) {
        if (chachedCalls[i].stopid  !== undefined && chachedCalls[i].stopid === stopid) {
            console.log("Found cached result for " + stopid);
            return chachedCalls.result;
        }
    }
    return undefined;
  }


  var containsTrain = function(a, train) {
    if( train === undefined ) return false;
    for (var i = 0; i < a.length; i++) {
        if (a[i].trainid === train.trainid) {
            return true;
        }
    }
    return false;
  }

  var isInLessThanMinutes = function(minutes, date){
      var inFiveMinutes = new Date(new Date().getTime() + minutes*60000);
      return  date < inFiveMinutes;
  }

  var getTrain = function(lineNo,destination,stopSeq,result){
    var train;
    var earliestDepartureDate;
    var obj = JSON.parse(result.content);              
    
    for (var j = 0; j < obj.length; j++) {
      var itIsTheRightTrain = obj[j].ExpectedDepartureTime !== null && obj[j].DestinationName === destination && obj[j].PublishedLineName === lineNo;
      if(itIsTheRightTrain){
        var trainid = obj[j].FramedVehicleJourneyRef.DatedVehicleJourneyRef;
        var departureDate = new Date(parseInt(obj[j].ExpectedDepartureTime.replace("/Date(","").replace("+0200)/","")));
        if(earliestDepartureDate === undefined) { earliestDepartureDate = departureDate }
        if(earliestDepartureDate >= departureDate){
          earliestDepartureDate = departureDate;
          train = {trainid:trainid,lastSeenOn:stopSeq,departureDate:departureDate}
        }
      }
    }

    return train;
  }

  var removeAllTrainsFromStations = function(line){  
      line.stops.forEach(function(stop){          
          stop.status=line.lineNo;
          stop.trainid="";
      });  
      return line;
  }

  var updateLine = function(lineNo,destination) {      
        var trains = [];
        var firstTrain;
        console.log("Updating line (Start) : " + lineNo + " - " + destination);    
        
        var line = removeAllTrainsFromStations(Line.findOne({lineNo:lineNo, destination:destination}));        
        for (var i = 0; i < line.stops.length; i++) {
          var station = line.stops[i];
          var result = callRuter(station.stop,station.stopid);
          if(result === undefined ) { station.status="red"; continue; };

          var train = getTrain(lineNo,destination,i,result);
          if(firstTrain === undefined){ firstTrain = train }

          if(train !== undefined && train.trainid !== undefined){
            if(i === 0 && train.trainid === firstTrain.trainid && isInLessThanMinutes(5,firstTrain.departureDate) && containsTrain(trains, train) === false){
              console.log("New train added!! Starting from start station. "+ train.trainid +" on station : " + station.stop);
              trains.push(train);
              station.status="train";              
            } else if(containsTrain(trains, train) === false && train.trainid !== firstTrain.trainid){
              console.log("Train "+ train.trainid +" on station : " + station.stop);
              trains.push(train);
              station.status="train";
            } else {
               console.log("No train on station : " + station.stop);
            }        
          }
        }
        line.trains = trains;
        Line.update({lineNo: lineNo, destination : destination},line);
        console.log("Updating line (Stop) : " + lineNo + " - " + destination);    
  }

 
  var updateLines = function(){
    chachedCalls = [];
    console.log("Updating lines");
    updateLine('L13','Drammen');
    updateLine('L13','Dal');
    updateLine('L2','Skøyen');
    updateLine('L2','Ski');
    updateLine('L21','Moss');
    updateLine('L21','Skøyen');
    chachedCalls = [];
  }

  var trainIsOnTheStation = function(train,result){ 
    if(result !== undefined ){
      var obj = JSON.parse(result.content);              
      for (var t = 0; t < obj.length; t++) {
          if(train.trainid == obj[t].FramedVehicleJourneyRef.DatedVehicleJourneyRef){
            return true;
          }
      }
    }
    return false;
  }
  
  var updateTrains = function(){
    console.log("Updating trains (start)");
    chachedCalls = [];
    Line.find({}).forEach(function(line){
    line = removeAllTrainsFromStations(line);

    line.trains.forEach(function(train){          
          var lastSeenStop = line.stops[train.lastSeenOn];
          var nextStop = line.stops[train.lastSeenOn+1];

          console.log(train.trainid + " - which was last seen on " + lastSeenStop.stop);

          // Is the train on this station?
          if(trainIsOnTheStation(train,callRuter( lastSeenStop.stop ,lastSeenStop.stopid))){
            console.log("Train is still registered at the station.")
            lastSeenStop.status="train";
            lastSeenStop.trainid=train.trainid;
          // Or perhaps on the next station?
          } else if(trainIsOnTheStation(train,callRuter( nextStop.stop ,nextStop.stopid))) {
            console.log("Train is not registered at the station. Next train is expected.")
            train.lastSeenOn++; 
            nextStop.status="train";
            nextStop.trainid=train.trainid;
          // If not, where can it be?
          } else {
            console.log("No place to put the train!")
          }
      });
      Line.update({_id:line._id},line);
    });
    chachedCalls = [];
    console.log("Updating trains (stop)");
  }
  

  Meteor.setInterval(updateTrains, 60000);
  Meteor.setInterval(updateLines, 10 * 60000);
  Meteor.setTimeout(updateLines, 5000);


  Meteor.startup(function () {
    Line.insert({
      'lineNo' : 'L13',
      'destination' :'Dal',
      'trains': [],
      'stops' : [
        {stop:'Drammen',stopid:6021000,status:'',trainid:''},
        {stop:'Brakerøya',stopid:6029020,status:'',trainid:''},
        {stop:'Lier',stopid:6264170,status:'',trainid:''},
        {stop:'Asker',stopid:2200500,status:'',trainid:''},
        {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
        {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
        {stop:'Leirsund',stopid:2310240,status:'',trainid:''},
        {stop:'Frogner',stopid:2260060,status:'',trainid:''},
        {stop:'Lindeberg',stopid:2260050,status:'',trainid:''},
        {stop:'Kløfta',stopid:2350005,status:'',trainid:''},
        {stop:'Jessheim',stopid:2350200,status:'',trainid:''},
        {stop:'Nordby',stopid:2350040,status:'',trainid:''},
        {stop:'Hauerseter',stopid:2350030,status:'',trainid:''},
        {stop:'Dal',stopid:2370600,status:'',trainid:''}
        ]
    });

    Line.insert({
      'lineNo' : 'L13',
      'destination' :'Drammen',
      'trains': [],
      'stops' : [
        {stop:'Dal',stopid:2370600,status:'',trainid:''},
        {stop:'Hauerseter',stopid:2350030,status:'',trainid:''},
        {stop:'Nordby',stopid:2350040,status:'',trainid:''},
        {stop:'Jessheim',stopid:2350200,status:'',trainid:''},
        {stop:'Kløfta',stopid:2350005,status:'',trainid:''},
        {stop:'Lindeberg',stopid:2260050,status:'',trainid:''},
        {stop:'Frogner',stopid:2260060,status:'',trainid:''},
        {stop:'Leirsund',stopid:2310240,status:'',trainid:''},
        {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
        {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
        {stop:'Asker',stopid:2200500,status:'',trainid:''},
        {stop:'Lier',stopid:6264170,status:'',trainid:''},
        {stop:'Brakerøya',stopid:6029020,status:'',trainid:''},
        {stop:'Drammen',stopid:6021000,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L2',
      'destination' :'Ski',
      'trains': [],
      'stops' : [
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Nordstrand',stopid:3010810,status:'',trainid:''},
        {stop:'Ljan',stopid:3010820,status:'',trainid:''},
        {stop:'Hauketo',stopid:3010910,status:'',trainid:''},
        {stop:'Holmlia',stopid:3010920,status:'',trainid:''},
        {stop:'Rosenholm',stopid:3010930,status:'',trainid:''},
        {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
        {stop:'Solbråtan',stopid:2170200,status:'',trainid:''},
        {stop:'Myrvoll',stopid:2170500,status:'',trainid:''},
        {stop:'Greverud',stopid:2170300,status:'',trainid:''},
        {stop:'Oppegård',stopid:2170400,status:'',trainid:''},
        {stop:'Vevelstad',stopid:2130700,status:'',trainid:''},
        {stop:'Langhus',stopid:2130500,status:'',trainid:''},
        {stop:'Ski',stopid:2130300,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L2',
      'destination' :'Skøyen',
      'trains': [],
      'stops' : [
        {stop:'Ski',stopid:2130300,status:'',trainid:''},
        {stop:'Langhus',stopid:2130500,status:'',trainid:''},
        {stop:'Vevelstad',stopid:2130700,status:'',trainid:''},
        {stop:'Oppegård',stopid:2170400,status:'',trainid:''},
        {stop:'Greverud',stopid:2170300,status:'',trainid:''},
        {stop:'Myrvoll',stopid:2170500,status:'',trainid:''},
        {stop:'Solbråtan',stopid:2170200,status:'',trainid:''},
        {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
        {stop:'Rosenholm',stopid:3010930,status:'',trainid:''},
        {stop:'Holmlia',stopid:3010920,status:'',trainid:''},
        {stop:'Hauketo',stopid:3010910,status:'',trainid:''},
        {stop:'Ljan',stopid:3010820,status:'',trainid:''},
        {stop:'Nordstrand',stopid:3010810,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L21',
      'destination' :'Moss',
      'trains': [],
      'stops' : [
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
        {stop:'Ski',stopid:2130300,status:'',trainid:''},
        {stop:'Ås',stopid:2140200,status:'',trainid:''},
        {stop:'Vestby',stopid:2110100,status:'',trainid:''},
        {stop:'Sonsveien',stopid:2110300,status:'',trainid:''},
        {stop:'Kambo',stopid:1040200,status:'',trainid:''},
        {stop:'Moss',stopid:1045160,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L21',
      'destination' :'Skøyen',
      'trains': [],
      'stops' : [
      {stop:'Moss',stopid:1045160,status:'',trainid:''},
      {stop:'Kambo',stopid:1040200,status:'',trainid:''},
      {stop:'Sonsveien',stopid:2110300,status:'',trainid:''},
      {stop:'Vestby',stopid:2110100,status:'',trainid:''},
      {stop:'Ås',stopid:2140200,status:'',trainid:''},
      {stop:'Ski',stopid:2130300,status:'',trainid:''},
      {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
      {stop:'Skøyen',stopid:3012500,status:'',trainid:''}
      ]
    });


});

}
